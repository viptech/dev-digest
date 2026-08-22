import { CiResultArtifact } from '@devdigest/shared';
import type { CiExport, CiFailOn, CiFile, CiInstallation, CiRun, CiTarget } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { ConfigError } from '../../platform/errors.js';
import { CiRepository, type CiInstallationRow } from './repository.js';
import { buildAgentManifest, serializeManifestYaml } from './manifest.js';
import { generateWorkflowYaml, WORKFLOW_GENERATOR_VERSION, type PostAs } from './workflow.js';
import {
  CI_RESULT_ARTIFACT_NAME,
  CI_WORKFLOW_FILE,
  UnsupportedCiTargetError,
  parseRepoSlug,
  toCiInstallationDto,
  toCiRunDto,
} from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — mirrors
 *  `reviews/run-executor.ts`'s `Logger` type, kept module-local so `ci/`
 *  doesn't reach into another feature module for a type. */
export type Logger = { warn: (obj: unknown, msg?: string) => void };

/** `GET /agents/:id/ci` response (T8) — no dedicated Zod contract (this
 *  read isn't request-validated, and most read routes in this codebase
 *  don't declare a `response` schema either, `server/INSIGHTS.md`
 *  2026-08-19 decision) — a plain, still-snake_case-at-the-wire TS shape. */
export interface AgentCiView {
  installations: CiInstallation[];
  ci_fail_on: CiFailOn;
  runs: CiRun[];
}

export interface ListCiRunsInput {
  since?: string;
  agentId?: string;
  repo?: string;
  status?: string;
  source?: string;
}

/**
 * ci module — service (SPEC-08 T3/T4). Orchestrates manifest + workflow +
 * skill files + the bundled runner into the CI file bundle, and the
 * Install-step GitHub write (commit + PR + `ci_installations` upsert).
 *
 * Onion-architecture boundary: this file never imports from
 * `agent-runner/src/*` — it only reads `agent-runner/dist/**` as an opaque
 * built ARTIFACT (bytes to embed), the exact same relationship the exported
 * PR itself has to that directory. `GitHubClient` and `RunnerBundleReader`
 * are both resolved through `container`, never constructed/read-from-disk
 * directly here (coordinator fix, `architecture-reviewer` finding: this
 * file used to call `node:fs` inline — moved to
 * `adapters/runner-bundle/fs.ts`, resolved via `container.runnerBundleReader`,
 * mirroring how `container.github()` is the only legal way to reach
 * `GitHubClient`).
 */

export interface ExportCiInput {
  repo: string;
  target: CiTarget;
  action: 'open_pr' | 'files';
  postAs: PostAs;
  triggers: string[];
  base: string;
  /** Wizard-side Preview edits (AC-12) — see `CiExportInput.file_overrides`'s
   *  doc-comment for the exact override semantics. */
  fileOverrides?: { path: string; contents: string }[];
}

/**
 * Apply Preview-step edits (AC-12) to the server-generated file list before
 * it's returned/committed. An override replaces that path's `contents`
 * verbatim — never merged/diffed. Silently ignored (not an error) when the
 * path either doesn't exist in `generated` or maps to a non-`editable` entry
 * (the bundled `.devdigest/runner/**` files) — the client never gets to
 * corrupt the shipped runner bytes just by sending a stray/stale override
 * for that path; a mismatched-but-editable path (e.g. stale skill slug from
 * an edit made before Preview was re-fetched with a different skill set) is
 * likewise a silent no-op rather than a 400, since it changes nothing that
 * would otherwise have been committed.
 */
function applyFileOverrides(
  generated: CiFile[],
  overrides: { path: string; contents: string }[] | undefined,
): CiFile[] {
  if (!overrides || overrides.length === 0) return generated;
  const overrideByPath = new Map(overrides.map((o) => [o.path, o.contents]));
  return generated.map((f) => {
    if (!f.editable) return f;
    const override = overrideByPath.get(f.path);
    return override === undefined ? f : { ...f, contents: override };
  });
}

/** Ephemeral "what would be installed" descriptor for the `action: 'files'`
 *  preview path (AC-7/AC-10 — no DB write on this path). `id: 'preview'`
 *  deliberately signals this is not a persisted row id. */
function previewInstallation(agentId: string, input: ExportCiInput): CiInstallation {
  return {
    id: 'preview',
    agent_id: agentId,
    repo: input.repo,
    target_type: input.target,
    installed_at: new Date().toISOString(),
    // Nothing is persisted on this path (AC-7/AC-10/AC-20) — there is no
    // real installation row yet, so no real workflow_version either.
    workflow_version: null,
  };
}

export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * `POST /agents/:id/export-ci` (T4). `action: 'files'` is the Preview/zip
   * path — pure, no side effects (AC-7/AC-10/AC-20). `action: 'open_pr'` is
   * the Install path — commits all files to `devdigest/ci`, opens/reuses a
   * PR, then upserts `ci_installations` (AC-19/AC-21: the GitHub call runs
   * FIRST; a failure there never reaches the DB write).
   * Returns `undefined` when the agent isn't in this workspace (route → 404).
   */
  async exportCi(workspaceId: string, agentId: string, input: ExportCiInput): Promise<CiExport | undefined> {
    if (input.target !== 'gha') throw new UnsupportedCiTargetError();

    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const files = await this.buildFiles(agent, input);

    if (input.action === 'files') {
      return { installation: previewInstallation(agent.id, input), files, pr_url: null };
    }

    const github = await this.container.github();
    const repoRef = parseRepoSlug(input.repo);
    const branch = 'devdigest/ci';

    await github.commitFiles(repoRef, {
      branch,
      base: input.base,
      message: 'Add DevDigest CI review',
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    const existingPr = await github.findOpenPr(repoRef, branch);
    const pr =
      existingPr ??
      (await github.openPullRequest(repoRef, {
        title: 'Add DevDigest CI review',
        head: branch,
        base: input.base,
        body: `Adds the DevDigest review workflow for **${agent.name}**.`,
      }));

    const installationRow = await this.repo.upsertInstallation({
      agentId: agent.id,
      repo: input.repo,
      targetType: input.target,
      workflowVersion: WORKFLOW_GENERATOR_VERSION,
    });

    return { installation: toCiInstallationDto(installationRow), files, pr_url: pr.url };
  }

  /** Build the CI file bundle for one agent (4 fixed files + one
   *  `.devdigest/skills/<slug>.md` per enabled+linked skill + however many
   *  files `agent-runner`'s build actually produced, G4/Edge cases). No
   *  side effects — safe to call from both the Preview and Install paths. */
  private async buildFiles(agent: AgentRow, input: ExportCiInput): Promise<CiFile[]> {
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agent.id);
    const { agentSlug, manifest, skills } = buildAgentManifest(agent, linkedSkills);

    const generated: CiFile[] = [
      {
        path: `.devdigest/agents/${agentSlug}.yaml`,
        contents: serializeManifestYaml(manifest),
        editable: true,
      },
      ...skills.map((s) => ({
        path: `.devdigest/skills/${s.slug}.md`,
        contents: s.body,
        editable: true,
      })),
      // AC-10: a valid, empty JSONL file — no Memory module exists yet to fill it.
      { path: '.devdigest/memory.jsonl', contents: '', editable: true },
      {
        path: '.github/workflows/devdigest-review.yml',
        contents: generateWorkflowYaml({ triggers: input.triggers, postAs: input.postAs }),
        editable: true,
      },
      ...this.readRunnerBundleFiles(),
    ];

    return applyFileOverrides(generated, input.fileOverrides);
  }

  /** Read every file `agent-runner`'s `pnpm build` (ncc) produced and embed
   *  each as its own non-editable CI file under
   *  `.devdigest/runner/<same relative path>`, via the
   *  `container.runnerBundleReader` port (never `node:fs` directly here —
   *  see the class doc-comment). ncc can emit MORE than one file (a main
   *  bundle plus a lazily-`import()`-ed secondary chunk from a transitive
   *  dependency, plus `package.json` declaring `"type":"module"` — required
   *  for the target repo's Node to parse the ESM bundle correctly regardless
   *  of that repo's own module system), so this embeds whatever the reader
   *  actually returns, never a hardcoded single file name. */
  private readRunnerBundleFiles(): CiFile[] {
    let files: { name: string; contents: string }[];
    try {
      files = this.container.runnerBundleReader.readFiles();
    } catch (err) {
      throw new ConfigError(
        `agent-runner bundle not available — run \`pnpm build\` in agent-runner/ ` +
          `(see agent-runner/README.md) before exporting CI files.`,
        { cause: (err as Error).message },
      );
    }
    return files.map((f) => ({ path: `.devdigest/runner/${f.name}`, contents: f.contents, editable: false }));
  }

  // ---------------------------------------------------------------------
  // Ingest — PULL-model polling (T6, AC-24/AC-25/AC-26)
  // ---------------------------------------------------------------------

  /** Refresh ONE installation by id — resolves its agent's workspaceId via
   *  a join (there is no other route to it from just an installation id).
   *  `{ inserted: 0 }` when the installation doesn't exist (never throws —
   *  a stale id from a deleted installation is a no-op, not an error). */
  async refreshInstallation(installationId: string, log?: Logger): Promise<{ inserted: number }> {
    const found = await this.repo.getInstallationWithWorkspace(installationId);
    if (!found) return { inserted: 0 };
    return this.ingestInstallation(found.installation, found.workspaceId, log);
  }

  /**
   * `POST /ci/refresh` (T6/T9). Every installation in `workspaceId`,
   * processed SEQUENTIALLY — the Development Plan's resolution of the
   * spec's own open "throughput" question: rely on this route's own
   * per-route rate limit (AC-34) for abuse protection rather than adding a
   * new concurrency primitive or background scheduler. The client's
   * "auto-refresh" toggle (T14) just calls this same endpoint on an
   * interval — it does not imply a server-side job.
   */
  async refreshAll(workspaceId: string, log?: Logger): Promise<{ inserted: number }> {
    const installations = await this.repo.listInstallationsForWorkspace(workspaceId);
    let inserted = 0;
    for (const installation of installations) {
      inserted += (await this.ingestInstallation(installation, workspaceId, log)).inserted;
    }
    return { inserted };
  }

  /**
   * One installation's ingest pass (AC-24): list runs of the generated
   * workflow newer than the last persisted `ran_at` (T6's dedup boundary —
   * no other unique key ties a GitHub run to a `ci_runs` row), download +
   * validate each run's artifact, and on success upsert `ci_runs` + insert
   * the `agent_runs`(source='ci') twin row. Any failure for ONE run (no
   * artifact, invalid schema, commit_sha mismatch, download error) skips
   * only that run — the loop always continues to the rest.
   */
  private async ingestInstallation(
    installation: CiInstallationRow,
    workspaceId: string,
    log?: Logger,
  ): Promise<{ inserted: number }> {
    // Only GHA installations are ever ingestable — CircleCI/Jenkins/Generic
    // CLI have no generator (Non-goals) and so can never have produced a
    // `devdigest-review.yml` run to poll for in the first place.
    if (installation.targetType !== 'gha') return { inserted: 0 };

    const github = await this.container.github();
    const repoRef = parseRepoSlug(installation.repo);
    const since = await this.repo.lastRanAt(installation.id);

    const runs = await github.listWorkflowRunsFor(repoRef, CI_WORKFLOW_FILE);
    const newRuns = runs.filter((r) => !since || new Date(r.ranAt) > since);

    let inserted = 0;
    for (const run of newRuns) {
      try {
        const raw = await github.downloadRunArtifact(repoRef, run.runId, CI_RESULT_ARTIFACT_NAME);
        if (raw === null) continue; // AC-23: no artifact yet — common (run still going/failed before upload), not a warning.

        const parsed = CiResultArtifact.safeParse(raw);
        if (!parsed.success) {
          log?.warn(
            { installationId: installation.id, repo: installation.repo, runId: run.runId },
            'ci ingest: artifact failed CiResultArtifact validation, skipping (AC-25)',
          );
          continue;
        }
        const artifact = parsed.data;

        // AC-26: verify against the run's OWN head_sha (from the GitHub API),
        // never trust the JSON's self-reported commit_sha alone.
        if (artifact.commit_sha !== run.headSha) {
          log?.warn(
            { installationId: installation.id, repo: installation.repo, runId: run.runId },
            'ci ingest: artifact commit_sha does not match the run head_sha, skipping (AC-26)',
          );
          continue;
        }

        const ranAt = new Date(run.ranAt);
        const status: 'succeeded' | 'no_findings' =
          artifact.findings_count > 0 ? 'succeeded' : 'no_findings';

        await this.repo.insertRun({
          ciInstallationId: installation.id,
          prNumber: artifact.pr_number ?? null,
          ranAt,
          status,
          findingsCount: artifact.findings_count,
          costUsd: artifact.cost_usd,
          githubUrl: run.htmlUrl,
          source: 'GitHub Actions',
          commitSha: artifact.commit_sha,
          model: artifact.model,
          agentVersion: artifact.agent_version ?? null,
          durationS: artifact.duration_ms != null ? artifact.duration_ms / 1000 : null,
          critical: artifact.critical ?? null,
          warning: artifact.warning ?? null,
          suggestion: artifact.suggestion ?? null,
        });

        await this.repo.insertAgentRun({
          workspaceId,
          agentId: installation.agentId,
          ranAt,
          model: artifact.model,
          durationMs: artifact.duration_ms ?? null,
          costUsd: artifact.cost_usd,
          findingsCount: artifact.findings_count,
        });

        inserted += 1;
      } catch (err) {
        // Network/download/malformed-zip failure for this one run — never
        // aborts the rest of the installation's runs or other installations.
        log?.warn(
          {
            installationId: installation.id,
            repo: installation.repo,
            runId: run.runId,
            error: (err as Error).message,
          },
          'ci ingest: failed to download/parse the run artifact, skipping',
        );
      }
    }
    return { inserted };
  }

  // ---------------------------------------------------------------------
  // Reads (T7, T8)
  // ---------------------------------------------------------------------

  /** `GET /ci/runs` (T7) — workspace-scoped, with the "All repos" filter's
   *  distinct-repo list (AC-30) returned alongside so the client doesn't
   *  need a second round-trip. */
  async listRuns(workspaceId: string, input: ListCiRunsInput): Promise<{ runs: CiRun[]; repos: string[] }> {
    const rows = await this.repo.listRuns({
      workspaceId,
      since: input.since ? new Date(input.since) : undefined,
      agentId: input.agentId,
      repo: input.repo,
      status: input.status,
      source: input.source,
    });
    const repos = await this.repo.listDistinctRepos(workspaceId);
    return { runs: rows.map(toCiRunDto), repos };
  }

  /** `GET /agents/:id/ci` (T8) — installations + read-only `ci_fail_on`
   *  passthrough (AC-32, no separate state) + this agent's own run history
   *  (AC-33, same row shape as T7, scoped to this agent's installations).
   *  Returns `undefined` when the agent isn't in this workspace (route →
   *  404, mirrors `exportCi`). */
  async getAgentCi(workspaceId: string, agentId: string): Promise<AgentCiView | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const installations = await this.repo.listInstallationsForAgent(agentId);
    const runRows = await this.repo.listRuns({ workspaceId, agentId });

    return {
      installations: installations.map(toCiInstallationDto),
      ci_fail_on: agent.ciFailOn as CiFailOn,
      runs: runRows.map(toCiRunDto),
    };
  }
}
