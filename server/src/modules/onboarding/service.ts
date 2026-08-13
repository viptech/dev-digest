import type { Onboarding, OnboardingResponse, OnboardingSection, Provider } from '@devdigest/shared';
import { Onboarding as OnboardingSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { estimateCost } from '../../adapters/llm/pricing.js';
import type { RepoFactsResult } from '../repo-intel/types.js';
import { OnboardingRepository } from './repository.js';
import { groundOnboardingSections } from './grounding.js';
import {
  GROUNDING_KNOWN_PATHS_N,
  MAX_ONBOARDING_FACT_CHARS,
  ONBOARDING_SECTION_KINDS,
  READING_ORDER_TOP_N,
  orderScriptsForLocalSetup,
} from './constants.js';

/** Minimal structured logger (pino-compatible) — mirrors conventions/service.ts's Logger. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * `undefined` = repo not found / not workspace-owned (→ 404, AC-14) or no
   * tour generated yet (→ 404, AC-13).
   */
  async get(workspaceId: string, repoId: string): Promise<OnboardingResponse | undefined> {
    const repoRow = await this.repo.getRepoForOnboarding(repoId);
    if (!repoRow || repoRow.workspaceId !== workspaceId) return undefined;
    const row = await this.repo.getByRepoId(repoId);
    if (!row) return undefined;
    const json = row.json as Onboarding;
    return {
      sections: json.sections,
      generated_at: row.generatedAt.toISOString(),
    };
  }

  /**
   * `undefined` = repo not found / not workspace-owned (→ 404, AC-14). The
   * ownership check runs BEFORE model resolution / any LLM call (AC-14) —
   * an unauthorized caller never triggers a paid LLM call.
   *
   * Returns a `degraded: true` response TRANSIENTLY (never persisted, AC-12)
   * when the index is degraded/absent or the LLM call fails; otherwise
   * grounds the model's sections and persists them (AC-6, AC-12).
   */
  async generate(
    workspaceId: string,
    repoId: string,
    logger?: Logger,
  ): Promise<OnboardingResponse | undefined> {
    // 1. Workspace-ownership check FIRST — before model resolution/LLM call.
    const repoRow = await this.repo.getRepoForOnboarding(repoId);
    if (!repoRow || repoRow.workspaceId !== workspaceId) return undefined;

    // 2. Resolve provider/model (AC-4).
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');

    // 3-6. Deterministic facts + graph reads, all via the RepoIntel facade.
    const state = await this.container.repoIntel.getIndexState(repoId);
    const facts = await this.container.repoIntel.getRepoFacts(repoId);
    const repoMap = await this.container.repoIntel.getRepoMap(repoId);
    const rankedForGrounding = await this.container.repoIntel.getTopFilesByRank(
      repoId,
      GROUNDING_KNOWN_PATHS_N,
    );
    const topFilesForReadingOrder = rankedForGrounding.slice(0, READING_ORDER_TOP_N);
    const criticalPaths = await this.container.repoIntel.getCriticalPaths(repoId);
    const criticalPathFiles = [...new Set(criticalPaths.flat())];

    // 7. Degrade check (AC-8, AC-10) — NO LLM call, never persisted.
    const noStackData =
      facts.dependencies.length === 0 && facts.devDependencies.length === 0 && facts.scripts.length === 0;
    if (
      state.degraded ||
      facts.degraded ||
      (noStackData && topFilesForReadingOrder.length === 0 && facts.routes.length === 0)
    ) {
      const reason = state.degradedReason ?? facts.reason ?? 'no_data';
      logger?.info(
        { repoId, call: 'onboarding.generate', model, tokensIn: 0, tokensOut: 0, costUsd: null },
        'onboarding.generate: degraded, no LLM call',
      );
      return {
        sections: buildDegradedSections(facts, repoMap.text, topFilesForReadingOrder, criticalPathFiles),
        degraded: true,
        degraded_reason: reason,
        generated_at: new Date().toISOString(),
      };
    }

    // 8. knownPaths — the FULL grounding universe, not just the small
    // reading-order list (cross-model review finding B3).
    const knownPaths = new Set<string>(rankedForGrounding);
    for (const p of criticalPathFiles) knownPaths.add(p);
    knownPaths.add('package.json');
    if (facts.packageManager === 'pnpm') knownPaths.add('pnpm-lock.yaml');
    if (facts.packageManager === 'npm') knownPaths.add('package-lock.json');
    if (facts.packageManager === 'yarn') knownPaths.add('yarn.lock');
    if (facts.envVarNames.length > 0) {
      knownPaths.add('.env.example');
      knownPaths.add('.env.sample');
    }
    if (facts.dockerServices.length > 0) {
      knownPaths.add('docker-compose.yml');
      knownPaths.add('docker-compose.yaml');
    }

    // 9. Raw third-party content (README/package.json) for the LLM to read
    // directly — wrapped as untrusted, DISTINCT from the deterministic
    // `facts` summary below (which is server-computed and never wrapped).
    const readmeRows = await this.container.repoIntel.readFiles(repoId, ['README.md']);
    const pkgRows = await this.container.repoIntel.readFiles(repoId, ['package.json']);
    const untrustedBlocks = [
      ...readmeRows.map((r) => wrapUntrusted('readme', r.content.slice(0, MAX_ONBOARDING_FACT_CHARS))),
      ...pkgRows.map((r) => wrapUntrusted('package.json', r.content.slice(0, MAX_ONBOARDING_FACT_CHARS))),
    ];

    const factsBlock = buildFactsBlock(facts, repoMap.text, topFilesForReadingOrder, criticalPathFiles);
    const systemPrompt = await renderPrompt('onboarding.system.md', {
      sections: ONBOARDING_SECTION_KINDS.join('\n'),
      language: 'English',
    });

    // 10-11. One structured LLM call (AC-3 — exactly one, no retry/second pass).
    let result: Awaited<ReturnType<typeof llmCompleteOnboarding>>;
    try {
      result = await llmCompleteOnboarding(this.container, provider, {
        model,
        systemPrompt,
        userMessage: [factsBlock, ...untrustedBlocks].join('\n\n'),
      });
    } catch (err) {
      logger?.warn(
        { repoId, call: 'onboarding.generate', model, err: err instanceof Error ? err.message : String(err) },
        'onboarding.generate: LLM call failed, returning degraded skeleton',
      );
      return {
        sections: buildDegradedSections(facts, repoMap.text, topFilesForReadingOrder, criticalPathFiles),
        degraded: true,
        degraded_reason: 'llm_call_failed',
        generated_at: new Date().toISOString(),
      };
    }

    // 12. Grounding gate (AC-6, AC-23).
    const groundedSections = groundOnboardingSections(result.data.sections, knownPaths);

    // 13-14. Cost + structured log line (NEVER logs prose/section content).
    const costUsd = estimateCost(model, result.tokensIn, result.tokensOut);
    logger?.info(
      { repoId, call: 'onboarding.generate', model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd },
      'onboarding.generate: prompt assembled',
    );

    // 15. Persist ONLY on this non-degraded, LLM-succeeded path (AC-12).
    const generatedAt = new Date();
    await this.repo.upsert(repoId, { json: { sections: groundedSections }, generatedAt });

    // 16. Return the OnboardingResponse DTO.
    return {
      sections: groundedSections,
      generated_at: generatedAt.toISOString(),
    };
  }
}

async function llmCompleteOnboarding(
  container: Container,
  provider: Provider,
  args: { model: string; systemPrompt: string; userMessage: string },
) {
  const llm = await container.llm(provider);
  return llm.completeStructured({
    model: args.model,
    schema: OnboardingSchema,
    schemaName: 'Onboarding',
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userMessage },
    ],
  });
}

/** Plain `FACTS:` block — server-computed, already-sanitized structured data
 *  (names and paths only, never raw third-party prose), so it is NOT wrapped
 *  via `wrapUntrusted` (same convention `reviewer-core/src/prompt.ts` already
 *  uses for its own repo-map/facts sections). */
function buildFactsBlock(
  facts: RepoFactsResult,
  repoMapText: string,
  readingOrderFiles: string[],
  criticalPathFiles: string[],
): string {
  const orderedScripts = orderScriptsForLocalSetup(facts.scripts);
  const lines: string[] = [
    'FACTS:',
    `- package manager: ${facts.packageManager ?? 'unknown'}`,
    `- dependencies: ${facts.dependencies.join(', ') || 'none'}`,
    `- devDependencies: ${facts.devDependencies.join(', ') || 'none'}`,
    `- scripts: ${orderedScripts.map((s) => `${s.name} = ${s.command}`).join(' | ') || 'none'}`,
    `- routes: ${facts.routes.join(', ') || 'none'}`,
    `- env var names: ${facts.envVarNames.join(', ') || 'none'}`,
    `- docker services: ${facts.dockerServices.join(', ') || 'none'}`,
    '',
    'REPO STRUCTURE (repo map):',
    repoMapText || '(unavailable)',
    '',
    'READING ORDER (top-ranked files, in this exact order — use exactly these paths, in this order, for the reading_order section):',
    readingOrderFiles.length > 0 ? readingOrderFiles.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'none',
    '',
    'CRITICAL PATH FILES (unique files across dependency chains — use these paths for the critical_paths section):',
    criticalPathFiles.length > 0 ? criticalPathFiles.join('\n') : 'none',
  ];
  return lines.join('\n');
}

/** Deterministic, no-LLM skeleton — plain bullet lists per `kind`, built
 *  straight from already-trusted facade facts (never grounded: these paths
 *  ARE the known-paths universe itself, not model output). */
function buildDegradedSections(
  facts: RepoFactsResult,
  repoMapText: string,
  readingOrderFiles: string[],
  criticalPathFiles: string[],
): OnboardingSection[] {
  const orderedScripts = orderScriptsForLocalSetup(facts.scripts);
  const installCmd =
    facts.packageManager === 'pnpm'
      ? 'pnpm install'
      : facts.packageManager === 'yarn'
        ? 'yarn install'
        : facts.packageManager === 'npm'
          ? 'npm install'
          : null;

  return [
    {
      kind: 'architecture',
      title: 'Architecture',
      body: repoMapText || 'No repo map available yet.',
      diagram: null,
      links: [],
    },
    {
      kind: 'critical_paths',
      title: 'Critical Paths',
      body:
        criticalPathFiles.length > 0
          ? criticalPathFiles.map((p) => `- ${p}`).join('\n')
          : 'No critical dependency chains available yet.',
      diagram: null,
      links: criticalPathFiles.map((p) => ({ label: p, path: p })),
    },
    {
      kind: 'local_setup',
      title: 'Local Setup',
      body: buildLocalSetupBody(installCmd, facts.packageManager, orderedScripts),
      diagram: null,
      links: [],
      commands: [
        ...(installCmd ? [{ cmd: installCmd }] : []),
        ...orderedScripts.map((s) => ({ cmd: `${facts.packageManager ?? 'npm'} run ${s.name}`, comment: s.command })),
      ],
    },
    {
      kind: 'reading_order',
      title: 'Reading Order',
      body:
        readingOrderFiles.length > 0
          ? 'Top-ranked files by import centrality (no written rationale — index degraded).'
          : 'No ranked files available yet.',
      diagram: null,
      links: readingOrderFiles.map((p) => ({ label: p, path: p })),
    },
    {
      kind: 'first_tasks',
      title: 'First Tasks',
      body: 'No suggested first tasks available — the tour could not be written this time.',
      diagram: null,
      links: [],
      tasks: [],
    },
  ];
}

function buildLocalSetupBody(
  installCmd: string | null,
  packageManager: RepoFactsResult['packageManager'],
  orderedScripts: { name: string; command: string }[],
): string {
  const lines: string[] = [];
  if (installCmd) lines.push(`- ${installCmd}`);
  for (const s of orderedScripts) lines.push(`- ${packageManager ?? 'npm'} run ${s.name}`);
  return lines.length > 0 ? lines.join('\n') : 'No package.json scripts found.';
}

// The "exactly 3 first_tasks entries" rule (AC-22г) is enforced by the
// prompt template (`onboarding.system.md`), not re-validated at runtime here —
// see `FIRST_TASKS_COUNT` in `./constants.ts` for where that number is fixed.
