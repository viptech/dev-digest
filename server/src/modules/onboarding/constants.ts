/**
 * onboarding module constants (SPEC-03).
 */

/**
 * Truncation budget for any RAW file content wrapped into the prompt (README,
 * raw `package.json` text) — a prompt-budget concern, not a repo-intel-facade
 * concern. Sits between the codebase's existing `MAX_PR_DESCRIPTION_CHARS =
 * 4000` and `MAX_CONTEXT_DOC_CHARS = 8000`, same order of magnitude as those
 * two precedents.
 */
export const MAX_ONBOARDING_FACT_CHARS = 6000;

/**
 * How many top-ranked files the `reading_order` section actually displays —
 * long enough for a genuinely useful guided-reading list, short enough to
 * stay "skimmable, not exhaustive" per the spec's own framing, same order of
 * magnitude as repo-intel's own `CRITICAL_PATH_ROOTS = 5`.
 */
export const READING_ORDER_TOP_N = 8;

/**
 * A SEPARATE, much larger `getTopFilesByRank` call whose ONLY purpose is
 * building the grounding gate's `knownPaths` set. `READING_ORDER_TOP_N` stays
 * small because it also drives the `reading_order` section's actual
 * displayed list length, but a small N there must never shrink the grounding
 * gate's known-paths universe, or AC-6 starts rejecting legitimate links the
 * model correctly cited from files outside the top 8.
 */
export const GROUNDING_KNOWN_PATHS_N = 500;

/**
 * Presentation/prompt-ordering preference for `local_setup` — NOT a
 * repo-intel-facade concern (`getRepoFacts.scripts` stays in package.json's
 * own order). `orderScriptsForLocalSetup` sorts by this list first
 * (matched-by-exact-key), then appends any remaining scripts in their
 * original order.
 */
export const LIFECYCLE_SCRIPT_ORDER = [
  'install',
  'dev',
  'start',
  'build',
  'test',
  'migrate',
  'db:migrate',
  'seed',
  'db:seed',
] as const;

/** Fixed five `kind` identifiers, in fixed order. */
export const ONBOARDING_SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'local_setup',
  'reading_order',
  'first_tasks',
] as const;
export type OnboardingSectionKind = (typeof ONBOARDING_SECTION_KINDS)[number];

/** `first_tasks` must return exactly this many `tasks[]` entries (AC-22(г)). */
export const FIRST_TASKS_COUNT = 3;

/** Order package.json scripts for the `local_setup` display: lifecycle order
 *  first (matched by exact key), then any remaining scripts in their
 *  original `package.json` order. Pure presentation helper — the facade's
 *  own `RepoFacts.scripts` is never reordered. */
export function orderScriptsForLocalSetup<T extends { name: string }>(scripts: T[]): T[] {
  const byName = new Map(scripts.map((s) => [s.name, s]));
  const ordered: T[] = [];
  const used = new Set<string>();
  for (const name of LIFECYCLE_SCRIPT_ORDER) {
    const s = byName.get(name);
    if (s) {
      ordered.push(s);
      used.add(name);
    }
  }
  for (const s of scripts) {
    if (!used.has(s.name)) ordered.push(s);
  }
  return ordered;
}
