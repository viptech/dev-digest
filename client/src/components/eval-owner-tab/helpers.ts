import type { EvalExpectation } from "@devdigest/shared";
import type { Severity, Category } from "@devdigest/ui";
import type { EvalCaseWithLastRun } from "@/lib/hooks/evals";
// `RunGroup`/`groupRuns`/`caseTransitions`/`METRIC_KEYS` moved to
// `@/lib/eval-runs` (SPEC-05 T15, Development Plan Addendum 3) once the new
// per-agent Eval Dashboard drill-down page became a second consumer
// (react-ui-architecture "promote on second user", same rule that already
// promoted `EvalCaseModal`/T13 and `METRIC_COLOR`). This file (moved here
// verbatim from `agents/[id]/.../EvalsTab/helpers.ts`, Development Plan
// `skill-editor.md` Step 5, SPEC-06 AC-17) imports those directly from
// `@/lib/eval-runs`; only the RunGroup TYPE is still needed here, for
// `deriveMetricCards`'s signature below.
import { METRIC_KEYS, type MetricKey, type RunGroup } from "@/lib/eval-runs";

/** MUST FIND/MUST NOT FLAG badge + severity-category tag for one case row —
 *  a discriminated union so a `must_find` tag's severity/category are only
 *  reachable after narrowing on `kind` (typescript-expert skill: avoids a
 *  loose `{ kind; severity?; category? }` shape where a `must_not_flag` tag
 *  could accidentally carry stale severity/category fields). */
export type CaseTag =
  | { kind: "must_find"; severity: Severity | null; category: Category | null }
  | { kind: "must_not_flag" };

/**
 * Derives the case-row tag from its `expected_output` (Development Plan
 * evals-tab-mockup-alignment.md, Open Question 1's resolution — the mockup
 * only ever shows one entry per case, but real data can have 0/1/N):
 *  - empty `expected_output` → `null` (no badge, no tag — nothing to
 *    classify for this row).
 *  - any `must_find` entry present → tag built from the FIRST `must_find`
 *    entry's severity/category (the "expected N, got M" subtitle already
 *    communicates the real count; remaining entries aren't visually
 *    distinguished). This intentionally does NOT reuse
 *    `eval-case-modal/helpers.ts`'s `deriveExpectationSummary` — that helper
 *    is scoped to build one full sentence for EXACTLY one entry, for the
 *    modal's editor context; this is a different concern (a short row tag
 *    tolerant of 0/1/N entries).
 *  - `must_not_flag`-only sets (any length) → `{ kind: "must_not_flag" }`
 *    ("assert empty", no severity/category to show).
 */
export function deriveCaseTag(expected: EvalExpectation[]): CaseTag | null {
  if (expected.length === 0) return null;
  const mustFind = expected.find((e) => e.type === "must_find");
  if (mustFind) {
    // Contract `Severity`/`FindingCategory` (findings.ts) are subsets of
    // `@devdigest/ui`'s `Severity`/`Category` — a safe widening assignment,
    // no cast needed (client/INSIGHTS.md 2026-07-31 covers the OPPOSITE,
    // narrowing direction, which does need one).
    return {
      kind: "must_find",
      severity: mustFind.severity ?? null,
      category: mustFind.category ?? null,
    };
  }
  return { kind: "must_not_flag" };
}

/** "{passing} / {total} passing" badge (last run's pass, not a fresh score —
 *  a case that was never run doesn't count toward `passing`). */
export function casesPassingSummary(cases: EvalCaseWithLastRun[]): { passing: number; total: number } {
  return {
    passing: cases.filter((c) => c.last_run?.pass === true).length,
    total: cases.length,
  };
}

export interface MetricCard {
  key: MetricKey;
  value: number; // 0–1
  /** vs. the previous set-run's aggregate; `null` when there is no previous
   *  set-run to compare against (exactly one set-run exists so far). */
  delta: number | null;
}

export interface MetricCardsSummary {
  cards: MetricCard[];
  tracesPassed: { passed: number; total: number };
}

/** Derives the 4-card metrics-block summary from `groupRuns()`'s output
 *  (Open Question 3's resolution: `groups.length === 0` → `null`, so the
 *  caller renders no card row at all rather than four cards full of zeros —
 *  the existing "No set-runs yet" empty state below already communicates
 *  that). `groups[0]` is the latest set-run (newest-first, per `groupRuns`);
 *  `groups[1]`, when present, is the previous one the deltas compare
 *  against. */
export function deriveMetricCards(groups: RunGroup[]): MetricCardsSummary | null {
  if (groups.length === 0) return null;
  const latest = groups[0]!;
  const previous = groups[1];
  const cards: MetricCard[] = METRIC_KEYS.map((key) => ({
    key,
    value: latest.aggregate[key],
    delta: previous ? latest.aggregate[key] - previous.aggregate[key] : null,
  }));
  return {
    cards,
    tracesPassed: {
      passed: latest.cases.filter((c) => c.pass === true).length,
      total: latest.cases.length,
    },
  };
}
