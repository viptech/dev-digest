import type { EvalRunRecord, EvalExpectation } from "@devdigest/shared";
import type { Severity, Category } from "@devdigest/ui";
import type { EvalCaseWithLastRun } from "@/lib/hooks/evals";

/** One historical set-run: every case's row that shares one `run_group_id`,
 *  plus a simple macro-average aggregate (same rule as the server's
 *  bulk-run response — a null metric is excluded from the average, not
 *  coerced to 0). */
export interface RunGroup {
  run_group_id: string;
  ran_at: string;
  cases: EvalRunRecord[];
  aggregate: { recall: number; precision: number; citation_accuracy: number };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Group a flat set-run-history response by `run_group_id`, newest first
 *  (AC-17). Rows with a `null` run_group_id (shouldn't happen — the server
 *  only returns set-runs here — but defensive) are dropped. */
export function groupRuns(rows: EvalRunRecord[]): RunGroup[] {
  const byGroup = new Map<string, EvalRunRecord[]>();
  for (const row of rows) {
    if (!row.run_group_id) continue;
    const list = byGroup.get(row.run_group_id) ?? [];
    list.push(row);
    byGroup.set(row.run_group_id, list);
  }
  const groups: RunGroup[] = Array.from(byGroup.entries()).map(([run_group_id, cases]) => {
    const ranAt = cases.reduce((max, c) => (c.ran_at > max ? c.ran_at : max), cases[0]!.ran_at);
    const recalls = cases.map((c) => c.recall).filter((v): v is number => v != null);
    const precisions = cases.map((c) => c.precision).filter((v): v is number => v != null);
    const citations = cases.map((c) => c.citation_accuracy).filter((v): v is number => v != null);
    return {
      run_group_id,
      ran_at: ranAt,
      cases,
      aggregate: {
        recall: average(recalls),
        precision: average(precisions),
        citation_accuracy: average(citations),
      },
    };
  });
  return groups.sort((a, b) => (a.ran_at < b.ran_at ? 1 : a.ran_at > b.ran_at ? -1 : 0));
}

/** Per-case pass/fail transitions between two set-runs (AC-19). A case
 *  present in only one of the two groups (the set changed between runs)
 *  renders as "no data" for the other side — never a fabricated fail. */
export interface CaseTransition {
  case_id: string;
  case_name: string | null;
  oldPass: boolean | null | undefined; // undefined = no data (case absent from that run)
  newPass: boolean | null | undefined;
}

export function caseTransitions(older: RunGroup, newer: RunGroup): CaseTransition[] {
  const byId = new Map<string, EvalRunRecord>();
  for (const c of older.cases) byId.set(c.case_id, c);
  const seen = new Set<string>();
  const rows: CaseTransition[] = [];
  for (const c of newer.cases) {
    const prev = byId.get(c.case_id);
    seen.add(c.case_id);
    rows.push({ case_id: c.case_id, case_name: c.case_name ?? null, oldPass: prev?.pass, newPass: c.pass });
  }
  for (const c of older.cases) {
    if (seen.has(c.case_id)) continue;
    rows.push({ case_id: c.case_id, case_name: c.case_name ?? null, oldPass: c.pass, newPass: undefined });
  }
  return rows;
}

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

const METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

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
