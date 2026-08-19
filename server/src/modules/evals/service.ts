import { randomUUID } from 'node:crypto';
import type { EvalCase, EvalExpectation, EvalRun, EvalRunRecord, EvalSetRunResult, Provider } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { AgentRow, EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import { AgentsRepository } from '../agents/repository.js';
import { EvalsRepository } from './repository.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  toEvalCaseDto,
  toEvalRunDto,
  toEvalRunRecordDto,
  scoreEvalCase,
  parseGroundingRatio,
  computeActualCount,
} from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — same shape as
 *  reviews/run-executor.ts's Logger, redeclared locally to avoid reaching
 *  into another module's internal file for just a type. */
export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

/** Summary of the most recent run for a case, attached to list() results
 *  (route-level response shape — not part of the shared EvalCase contract,
 *  to avoid the dual-copy client/server contract drift this feature has hit
 *  before). */
export interface EvalCaseWithLastRun extends EvalCase {
  last_run: { pass: boolean; recall: number; ran_at: string; actual_count: number } | null;
}

export interface CreateEvalCaseInput {
  name: string;
  input_diff?: string;
  input_meta?: unknown;
  expected_output?: EvalExpectation[];
  notes?: string;
}

export type UpdateEvalCaseInput = Partial<CreateEvalCaseInput>;

/** Unsaved draft returned by `createFromFinding` (SPEC-05 T13) — no `id`, no
 *  DB row. Route-level response shape (not part of the shared EvalCase
 *  contract — same dual-copy-avoidance rationale as EvalCaseWithLastRun).
 *  Persisted only once the client Saves/Runs it through the existing
 *  `POST /agents/:id/evals` path. */
export interface EvalCaseDraft {
  owner_id: string;
  name: string;
  input_diff: string;
  input_meta: unknown;
  expected_output: EvalExpectation[];
}

/** One historical set-run for the Eval Dashboard (SPEC-05 T14). `version` is
 *  a per-agent ORDINAL COUNTER over that agent's own set-runs by `ran_at`
 *  ascending (1 = the agent's oldest set-run) — unrelated to the
 *  `agent_versions` table's config-versioning concept; never queries it. */
export interface EvalDashboardRunSummary {
  run_group_id: string;
  version: number;
  ran_at: string;
  cases_total: number;
  cases_passed: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/** Eval Dashboard per-agent summary (route-level response shape — same
 *  dual-copy-avoidance rationale as EvalCaseWithLastRun). */
export interface EvalDashboardAgentSummary {
  agent_id: string;
  agent_name: string;
  agent_model: string;
  cases_total: number;
  /** Newest-first, capped at 10 (SPEC-05 T14). */
  recent_runs: EvalDashboardRunSummary[];
  /** `recent_runs[0] ?? null` — kept as its own field for backward
   *  compatibility with any reader of the pre-T14 dashboard shape. */
  last_run: EvalDashboardRunSummary | null;
}

export class EvalsService {
  private repo: EvalsRepository;
  private agents: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
    this.agents = container.agentsRepo;
  }

  async list(workspaceId: string, agentId: string): Promise<EvalCaseWithLastRun[]> {
    const rows = await this.repo.listByOwner(workspaceId, 'agent', agentId);
    const lastRuns = await this.repo.latestRunByCase(rows.map((r) => r.id));
    return rows.map((row) => {
      const run = lastRuns.get(row.id);
      // actual_count (Development Plan evals-tab-mockup-alignment.md, Ordered
      // Step 1): derived here in the service layer from the already-fetched
      // EvalRunRow, not in the route handler — feeds the client's "expected
      // N, got M" subtitle (Open Question 2: when run == null there's no
      // last_run at all, so no actual_count to fabricate either).
      return {
        ...toEvalCaseDto(row),
        last_run: run
          ? {
              pass: !!run.pass,
              recall: run.recall ?? 0,
              ran_at: new Date(run.ranAt).toISOString(),
              actual_count: computeActualCount(run.actualOutput),
            }
          : null,
      };
    });
  }

  async create(workspaceId: string, agentId: string, input: CreateEvalCaseInput): Promise<EvalCase> {
    const row = await this.repo.insert({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? [],
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async update(
    workspaceId: string,
    agentId: string,
    caseId: string,
    patch: UpdateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const existing = await this.repo.getById(workspaceId, caseId);
    if (!existing || existing.ownerId !== agentId) return undefined;

    const row = await this.repo.update(workspaceId, caseId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async delete(workspaceId: string, agentId: string, caseId: string): Promise<boolean> {
    const existing = await this.repo.getById(workspaceId, caseId);
    if (!existing || existing.ownerId !== agentId) return false;
    return this.repo.deleteById(workspaceId, caseId);
  }

  /**
   * Run the agent's live config (system prompt, model, currently
   * linked+enabled skills) against one eval case's diff, score it
   * deterministically (`scoreEvalCase`), and persist an `eval_runs` row.
   * Shared by `run()` (single case) and `runSet()` (bulk, T4) — the caller
   * resolves `agent`/`skillBodies` ONCE for a whole set, never per case.
   */
  private async executeCase(
    agent: AgentRow,
    skillBodies: string[],
    evalCase: EvalCaseRow,
    runGroupId: string | null,
  ): Promise<{ case: EvalCase; runRow: EvalRunRow }> {
    if (!evalCase.inputDiff || evalCase.inputDiff.trim().length === 0) {
      throw new ValidationError('Eval case has no diff to review');
    }

    const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
    const llm = await this.container.llm(agent.provider as Provider);
    const meta = (evalCase.inputMeta ?? {}) as { title?: string; body?: string };
    const task = meta.title ? `Review: "${meta.title}"` : undefined;

    const start = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: 'single-pass',
      ...(skillBodies.length ? { skills: skillBodies } : {}),
      ...(task ? { task } : {}),
      ...(meta.body ? { prDescription: meta.body } : {}),
      sessionId: `eval:${evalCase.id}`,
    });
    const durationMs = Date.now() - start;

    const expected = (Array.isArray(evalCase.expectedOutput) ? evalCase.expectedOutput : []) as EvalExpectation[];
    const score = scoreEvalCase(expected, outcome.review.findings);
    const citationAccuracy = parseGroundingRatio(outcome.grounding);

    const runRow = await this.repo.insertRun({
      caseId: evalCase.id,
      runGroupId,
      actualOutput: outcome.review.findings,
      pass: score.pass,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy,
      durationMs,
      costUsd: outcome.costUsd,
    });

    return { case: toEvalCaseDto(evalCase), runRow };
  }

  /**
   * Run one eval case against the agent's LIVE config (system prompt, model,
   * and its currently linked+enabled skills — same resolution Plan A wired
   * into run-executor.ts). No repo-intel enrichment: an eval case is an
   * isolated fixture diff, not tied to a cloned repo.
   */
  async run(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<{ case: EvalCase; run: EvalRun } | undefined> {
    const evalCase = await this.repo.getById(workspaceId, caseId);
    if (!evalCase || evalCase.ownerId !== agentId) return undefined;

    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const linkedSkills = await this.agents.linkedSkills(agentId);
    const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    const { case: dto, runRow } = await this.executeCase(agent, skillBodies, evalCase, null);
    return { case: dto, run: toEvalRunDto(runRow) };
  }

  /**
   * Bulk-run every eval case in the agent's set (SPEC-05 AC-11/AC-12/AC-13/
   * AC-14): resolve the agent + its linked skills ONCE, run each case
   * sequentially (bounds peak concurrent LLM calls to 1; set sizes here are
   * small, this is a manually-triggered button, not a hot path), persisting
   * every case's row under one shared `run_group_id`. A case whose LLM call
   * throws is recorded as `pass: false` with null metrics and does NOT abort
   * the rest of the set (AC-14).
   */
  async runSet(workspaceId: string, agentId: string, logger?: Logger): Promise<EvalSetRunResult | undefined> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cases = await this.repo.listByOwner(workspaceId, 'agent', agentId);
    if (cases.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }

    const linkedSkills = await this.agents.linkedSkills(agentId);
    const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    const runGroupId = randomUUID();
    const cases_: EvalSetRunResult['cases'] = [];
    let recallSum = 0;
    let recallCount = 0;
    let precisionSum = 0;
    let precisionCount = 0;
    let citationSum = 0;
    let citationCount = 0;
    let failedCount = 0;

    for (const evalCase of cases) {
      const start = Date.now();
      try {
        const { runRow } = await this.executeCase(agent, skillBodies, evalCase, runGroupId);
        cases_.push(toEvalRunRecordDto(runRow, evalCase.name));
        if (runRow.recall != null) {
          recallSum += runRow.recall;
          recallCount += 1;
        }
        if (runRow.precision != null) {
          precisionSum += runRow.precision;
          precisionCount += 1;
        }
        if (runRow.citationAccuracy != null) {
          citationSum += runRow.citationAccuracy;
          citationCount += 1;
        }
      } catch (err) {
        failedCount += 1;
        // Never log prose (rationale/actual_output) — only ids/metrics (NFR).
        logger?.warn(
          { caseId: evalCase.id, agentId, runGroupId, error: err instanceof Error ? err.message : String(err) },
          'eval set-run: one case failed, continuing with the rest of the set',
        );
        const failedRow = await this.repo.insertRun({
          caseId: evalCase.id,
          runGroupId,
          actualOutput: null,
          pass: false,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs: Date.now() - start,
          costUsd: null,
        });
        cases_.push(toEvalRunRecordDto(failedRow, evalCase.name));
      }
    }

    if (failedCount > 0) {
      // A failed case is excluded from the average's denominator for that
      // metric, never coerced to 0 — logged explicitly per the Development Plan.
      logger?.info(
        { agentId, runGroupId, casesTotal: cases.length, failedCount },
        'eval set-run: excluding failed case(s) from the aggregate denominator',
      );
    }

    return {
      run_group_id: runGroupId,
      aggregate: {
        recall: recallCount === 0 ? 0 : recallSum / recallCount,
        precision: precisionCount === 0 ? 0 : precisionSum / precisionCount,
        citation_accuracy: citationCount === 0 ? 0 : citationSum / citationCount,
      },
      cases: cases_,
    };
  }

  /** Historical set-runs for this agent, grouped by `run_group_id` on the
   *  client side, newest first (AC-17). */
  async listSetRuns(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const rows = await this.repo.listSetRunsByOwner(workspaceId, 'agent', agentId);
    return rows.map((row) => toEvalRunRecordDto(row, row.caseName));
  }

  /**
   * Workspace-wide Eval Dashboard (AC-20/AC-21, T14): every agent with its
   * cases count and its FULL set-run history (grouped by `run_group_id`,
   * newest-first, capped at 10 as `recent_runs`) — not just the latest one.
   * `last_run` is `recent_runs[0] ?? null` ("Never run", AC-21). Exactly 3
   * flat aggregate queries total (agent list, case counts grouped by owner,
   * set-runs grouped by owner) — never one query per agent.
   */
  async dashboard(workspaceId: string): Promise<EvalDashboardAgentSummary[]> {
    const [agents, caseCounts, allRuns] = await Promise.all([
      this.agents.list(workspaceId),
      this.repo.caseCountsByOwner(workspaceId, 'agent'),
      this.repo.allSetRuns(workspaceId, 'agent'),
    ]);

    // Group runs by owner, then by run_group_id, in memory (no per-agent query).
    const runsByOwner = new Map<string, typeof allRuns>();
    for (const run of allRuns) {
      const list = runsByOwner.get(run.ownerId) ?? [];
      list.push(run);
      runsByOwner.set(run.ownerId, list);
    }

    return agents.map((agent) => {
      const runs = runsByOwner.get(agent.id) ?? [];

      // `runs` is already ordered newest-first (repo query). Group by
      // run_group_id, preserving that newest-first order between groups —
      // the first row seen for a group is that group's most-recent row.
      const groupIds: string[] = [];
      const rowsByGroup = new Map<string, typeof runs>();
      for (const run of runs) {
        const gid = run.runGroupId!;
        let list = rowsByGroup.get(gid);
        if (!list) {
          list = [];
          rowsByGroup.set(gid, list);
          groupIds.push(gid);
        }
        list.push(run);
      }

      const summarize = (gid: string): Omit<EvalDashboardRunSummary, 'version'> => {
        const group = rowsByGroup.get(gid)!;
        const withRecall = group.filter((r) => r.recall != null);
        const withPrecision = group.filter((r) => r.precision != null);
        const withCitation = group.filter((r) => r.citationAccuracy != null);
        return {
          run_group_id: gid,
          ran_at: new Date(group[0]!.ranAt).toISOString(),
          cases_total: group.length,
          cases_passed: group.filter((r) => r.pass).length,
          recall: withRecall.length === 0 ? 0 : withRecall.reduce((s, r) => s + r.recall!, 0) / withRecall.length,
          precision:
            withPrecision.length === 0 ? 0 : withPrecision.reduce((s, r) => s + r.precision!, 0) / withPrecision.length,
          citation_accuracy:
            withCitation.length === 0
              ? 0
              : withCitation.reduce((s, r) => s + r.citationAccuracy!, 0) / withCitation.length,
        };
      };

      // `groupIds` is newest-first; `version` is an ordinal counter over the
      // agent's OWN set-run history, ascending, 1 = oldest (T14) — so the
      // oldest group (last in `groupIds`) gets version 1.
      const total = groupIds.length;
      const allRunsNewestFirst: EvalDashboardRunSummary[] = groupIds.map((gid, i) => ({
        ...summarize(gid),
        version: total - i,
      }));

      const recent_runs = allRunsNewestFirst.slice(0, 10);
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        agent_model: agent.model,
        cases_total: caseCounts.get(agent.id) ?? 0,
        recent_runs,
        last_run: recent_runs[0] ?? null,
      };
    });
  }

  /**
   * Build (but do NOT persist) a draft regression eval case from one
   * accept/dismiss-decided finding (SPEC-05 T13, corrected AC-1/AC-4: the
   * reference implementation opens the existing `EvalCaseModal` pre-filled
   * and unsaved, rather than creating a row immediately). Read side resolves
   * via `container.reviewRepo` — the same "read another module's data
   * through your own repository call" pattern already established in this
   * codebase (server/INSIGHTS.md 2026-08-11). Access-control (AC-23 — 404 on
   * a foreign-workspace finding) still runs before anything else; there's
   * just no DB write left to guard for by the time this returns.
   */
  async createFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new ValidationError('Finding has no accept/dismiss decision yet');
    }
    if (!review.agentId) {
      throw new ValidationError("Finding's review has no agent");
    }

    const expectation: EvalExpectation = {
      type: finding.acceptedAt ? 'must_find' : 'must_not_flag',
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      severity: finding.severity as EvalExpectation['severity'],
      category: finding.category as EvalExpectation['category'],
    };

    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const prFile = prFiles.find((f) => f.path === finding.file);
    const inputDiff = reconstructSingleFileDiff(finding.file, prFile?.patch ?? null);

    return {
      owner_id: review.agentId,
      name: `From finding: ${finding.title}`.slice(0, 120),
      input_diff: inputDiff,
      input_meta: null,
      expected_output: [expectation],
    };
  }
}

/**
 * Reconstruct a single-file unified diff from GitHub's `pr_files.patch`
 * (which contains the hunk body — usually already starting with its own
 * `@@ ... @@` header — but never the file-level `diff --git`/`---`/`+++`
 * lines `parseUnifiedDiff()` requires). Falls back to a synthetic
 * `@@ -0,0 +1,<n> @@` header only when the patch doesn't already start with
 * one. Empty/null patch → empty diff (the eventual run then hits the
 * existing empty-diff `ValidationError` guard, unchanged).
 */
function reconstructSingleFileDiff(path: string, patch: string | null): string {
  if (!patch || patch.trim().length === 0) return '';
  const lines = patch.split('\n');
  const hasHunkHeader = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(lines[0] ?? '');
  const header = hasHunkHeader ? '' : `@@ -0,0 +1,${lines.length} @@\n`;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${header}${patch}`;
}
