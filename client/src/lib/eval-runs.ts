import type { EvalRunRecord } from "@devdigest/shared";

/** Shared metric keys across every eval-metrics surface (EvalsTab, Eval
 *  Dashboard, per-agent drill-down) — one canonical list + key type so a
 *  new metric only needs to be added in one place. */
export const METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** One historical set-run: every case's row that shares one `run_group_id`,
 *  plus a simple macro-average aggregate (same rule as the server's
 *  bulk-run response — a null metric is excluded from the average, not
 *  coerced to 0).
 *
 *  Promoted here from `EvalsTab/helpers.ts` (SPEC-05 T15, Development Plan
 *  `.claude/plans/eval-pipeline.md` Addendum 3) — the new per-agent Eval
 *  Dashboard drill-down page (`app/eval-dashboard/[agentId]`) becoming a
 *  second consumer of `RunGroup`/`groupRuns`/`caseTransitions` is the
 *  react-ui-architecture "promote on second user" trigger — same rule that
 *  already promoted `EvalCaseModal` (T13) and `METRIC_COLOR`
 *  (evals-tab-mockup-alignment.md, now `@/lib/eval-metrics`). */
export interface RunGroup {
  run_group_id: string;
  ran_at: string;
  cases: EvalRunRecord[];
  aggregate: { recall: number; precision: number; citation_accuracy: number };
  /** The `system_prompt_snapshot` shared by every row in this group (T15) —
   *  taken from the first case row that has one. `null` when none do
   *  (defensively for an empty group, or because every row predates the
   *  migration that added this column). */
  systemPromptSnapshot: string | null;
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
    const snapshot = cases.find((c) => c.system_prompt_snapshot != null)?.system_prompt_snapshot ?? null;
    return {
      run_group_id,
      ran_at: ranAt,
      cases,
      aggregate: {
        recall: average(recalls),
        precision: average(precisions),
        citation_accuracy: average(citations),
      },
      systemPromptSnapshot: snapshot,
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

/** A `RunGroup` plus its per-agent ordinal `version` (1 = this agent's
 *  oldest set-run) — the same numbering rule the server's `dashboard()`
 *  aggregate already applies (`server/src/modules/evals/service.ts`), but
 *  derived client-side here since `useEvalRunHistory` doesn't return it:
 *  `groups` is already newest-first (`groupRuns`), so `version = total - i`
 *  gives an ascending oldest→newest counter without a second data source.
 *
 *  Promoted here (from `EvalAgentDashboardView/helpers.ts`) once
 *  `CompareRunsModal` — a sibling component, not that view itself — became
 *  a second consumer; same "promote on second user" rule as `RunGroup`
 *  above, just applied one component later. */
export interface VersionedRunGroup extends RunGroup {
  version: number;
}

export function withVersions(groups: RunGroup[]): VersionedRunGroup[] {
  const total = groups.length;
  return groups.map((g, i) => ({ ...g, version: total - i }));
}

/** Selecting a 3rd run drops the oldest selection — comparison is always
 *  between exactly the two most-recently-clicked runs. Originally inline in
 *  `EvalsTab.tsx` (T8); extracted here (T15) so the drill-down page's own
 *  run-history table (also capped at 2 selections) reuses the same rule
 *  instead of re-deriving it. */
export function toggleRunSelection(prev: string[], id: string, max = 2): string[] {
  if (prev.includes(id)) return prev.filter((x) => x !== id);
  if (prev.length >= max) return [...prev.slice(1), id];
  return [...prev, id];
}
