import type { CiRun } from "@devdigest/shared";

/**
 * `CiRun.status` is a plain `z.string()` at the wire, not a strict enum in
 * the DTO (see `eval-ci.ts`'s `CiRun`) — mirrors `CiTab/helpers.ts`'s
 * identically-named helper (same class of duplication already tolerated
 * elsewhere in this codebase for small pure formatters; see this session's
 * report for a promotion note). Maps to the `ci.runs.status.*` i18n keys,
 * falling back to the raw value for anything unexpected instead of
 * throwing.
 */
const STATUS_I18N_KEY: Record<string, string> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};

export function statusI18nKey(status: string | null): string {
  if (!status) return "succeeded";
  return STATUS_I18N_KEY[status] ?? status;
}

/** Distinct, non-null `source` values seen in the currently loaded run
 *  list, for the SOURCE filter's options. There is no server-side
 *  distinct-sources endpoint (unlike `repos`, AC-30) — every run this
 *  system has ever ingested carries the literal `'GitHub Actions'`
 *  (`ci/service.ts`'s `ingestInstallation`; CircleCI/Jenkins/Generic CLI
 *  are explicit SPEC-08 non-goals with no generator, so no other value can
 *  exist yet) — deriving it client-side from the loaded rows avoids
 *  hardcoding that literal a second time while staying correct if a future
 *  CI target ever produces a different value. */
export function distinctSources(runs: CiRun[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.source) seen.add(run.source);
  }
  return Array.from(seen).sort();
}

/** ISO timestamp for "7 days ago" — the CI Runs page's fixed default
 *  window (AC-28's `since` filter; the page currently offers no other
 *  window, see `messages/en/ci.json`'s `runs.filters` — only `last7Days`
 *  exists). Computed once per call, not reactively — callers `useMemo`
 *  it with an empty dep array so the window doesn't creep forward on every
 *  render/refresh within one page visit. */
export function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}
