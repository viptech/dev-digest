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

// `diffPromptLines`/`PromptDiffLine` moved to `@/lib/text-diff` (Development
// Plan `skill-editor.md` Step 9, SPEC-06 AC-29) — the Versions tab's
// version-body diff is a second caller from a different feature tree, and
// this utility was never eval-specific to begin with. Re-export removed
// deliberately; import from the new location.
