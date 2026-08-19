import { METRIC_KEYS, type MetricKey, type RunGroup } from "@/lib/eval-runs";

export interface MetricDelta {
  key: MetricKey;
  older: number;
  newer: number;
  delta: number;
}

/** Per-metric older→newer values + delta, for the modal's "Metric deltas"
 *  section — reuses each `RunGroup`'s already-computed macro-average
 *  aggregate, no re-derivation from raw case rows. */
export function computeMetricDeltas(older: RunGroup, newer: RunGroup): MetricDelta[] {
  return METRIC_KEYS.map((key) => ({
    key,
    older: older.aggregate[key],
    newer: newer.aggregate[key],
    delta: newer.aggregate[key] - older.aggregate[key],
  }));
}

/** A `RunGroup`'s own average `cost_usd` across its case rows — not part of
 *  the shared `RunGroup.aggregate` (which only carries recall/precision/
 *  citation_accuracy), so derived locally here since only this modal shows
 *  cost. `null` cost rows are excluded from the average, never coerced to 0
 *  (same rule as the server's own aggregate). */
export function averageCost(group: RunGroup): number | null {
  const costs = group.cases.map((c) => c.cost_usd).filter((v): v is number => v != null);
  return costs.length === 0 ? null : costs.reduce((s, v) => s + v, 0) / costs.length;
}

export interface PromptDiffLine {
  text: string;
  status: "removed" | "added" | "unchanged";
}

/**
 * Naive line-level diff between two `system_prompt_snapshot` values (SPEC-05
 * T15, explicit non-goal: no Myers-diff quality, no new npm dependency —
 * `client` has neither `diff` nor `jsdiff`). Heuristic: a line present only
 * in `oldText` is "removed", a line present only in `newText` is "added", a
 * line present in both is "unchanged" (rendered from `newText`'s ordering).
 * Callers should not invoke this with a `null` side — check for that first
 * and render a "not captured for this run" message instead (this function
 * itself just treats `null` as an empty prompt, so it never throws).
 */
export function diffPromptLines(oldText: string | null, newText: string | null): PromptDiffLine[] {
  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const lines: PromptDiffLine[] = [];
  for (const line of oldLines) {
    if (!newSet.has(line)) lines.push({ text: line, status: "removed" });
  }
  for (const line of newLines) {
    lines.push({ text: line, status: oldSet.has(line) ? "unchanged" : "added" });
  }
  return lines;
}
