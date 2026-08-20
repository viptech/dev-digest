import {
  METRIC_KEYS,
  caseTransitions,
  withVersions,
  type MetricKey,
  type RunGroup,
  type VersionedRunGroup,
} from "@/lib/eval-runs";

// `VersionedRunGroup`/`withVersions` live in `@/lib/eval-runs` (promoted
// once `CompareRunsModal`, a sibling component, needed them too) — re-export
// so this file's own callers (and the rest of this page's tree) don't need
// to know about the split.
export { withVersions, type VersionedRunGroup };

const METRIC_LABEL: Record<MetricKey, string> = {
  recall: "Recall",
  precision: "Precision",
  citation_accuracy: "Citation accuracy",
};

/** One of the 3 metric cards on the drill-down page: latest value, delta vs.
 *  the previous set-run (`null` when there isn't one yet), and a full
 *  oldest→newest sparkline series across the agent's whole history. */
export interface AgentMetricCard {
  key: MetricKey;
  value: number;
  delta: number | null;
  sparkline: number[];
}

export function deriveAgentMetricCards(groups: RunGroup[]): AgentMetricCard[] | null {
  if (groups.length === 0) return null;
  const latest = groups[0]!;
  const previous = groups[1];
  const oldestFirst = groups.slice().reverse();
  return METRIC_KEYS.map((key) => ({
    key,
    value: latest.aggregate[key],
    delta: previous ? latest.aggregate[key] - previous.aggregate[key] : null,
    sparkline: oldestFirst.map((g) => g.aggregate[key]),
  }));
}

/** Feeds `@devdigest/ui`'s full `LineChart` (3 series, oldest→newest — the
 *  reverse of `groups`' own newest-first order). */
export function toChartSeries(groups: RunGroup[], colorFor: (key: MetricKey) => string) {
  const oldestFirst = groups.slice().reverse();
  return METRIC_KEYS.map((key) => ({
    name: METRIC_LABEL[key],
    color: colorFor(key),
    data: oldestFirst.map((g) => g.aggregate[key]),
  }));
}

/**
 * Code-generated insight banner (SPEC-05 T15, no LLM call — same principle
 * as the rest of the scoring pipeline). Rule, from the spec's Open
 * questions/T15 entry:
 *  1. No metric dropped between the two newest set-runs → no banner at all.
 *  2. Otherwise, the metric with the largest drop leads: "{Metric} dipped
 *     {N}pts on v{version}".
 *  3. If a case flipped pass→fail between the two runs AND that SAME case's
 *     own `worst`-metric value also got worse, append a consequence clause
 *     keyed off which metric dropped — precision dropping is the
 *     false-positive signal, recall dropping is the missed-case signal.
 *     Correlating by case (not just "some case flipped, and some metric
 *     dropped in aggregate" — those can be different cases) is what keeps
 *     this claim honest; the drill-down page still only has run-level
 *     metrics per case, not each case's must_find/must_not_flag type, so
 *     this is a metric-level proxy for that per-case classification, just a
 *     correlated one rather than a coincidental one.
 *  4. The other two metrics, when neither also dropped, get a trailing
 *     "{X} and {Y} both up"/"stable" clause.
 */
export function deriveInsightBanner(groups: RunGroup[]): string | null {
  if (groups.length < 2) return null;
  const versioned = withVersions(groups);
  const newer = versioned[0]!;
  const older = versioned[1]!;

  const deltas: Record<MetricKey, number> = {
    recall: newer.aggregate.recall - older.aggregate.recall,
    precision: newer.aggregate.precision - older.aggregate.precision,
    citation_accuracy: newer.aggregate.citation_accuracy - older.aggregate.citation_accuracy,
  };

  const dropped = METRIC_KEYS.filter((k) => deltas[k] < 0);
  if (dropped.length === 0) return null;

  const worst = dropped.reduce((a, b) => (deltas[b] < deltas[a] ? b : a));
  const pts = Math.round(Math.abs(deltas[worst]) * 100);
  let message = `${METRIC_LABEL[worst]} dipped ${pts}pts on v${newer.version}`;

  const flipped = caseTransitions(older, newer).filter((tr) => tr.oldPass === true && tr.newPass === false);
  const newerById = new Map(newer.cases.map((c) => [c.case_id, c]));
  const olderById = new Map(older.cases.map((c) => [c.case_id, c]));
  // Only claim causation for a flipped case whose OWN `worst`-metric value
  // also got worse — ties the sentence to a real per-case signal instead of
  // any flip coinciding with any drop.
  const causal = flipped.some((tr) => {
    const nv = newerById.get(tr.case_id)?.[worst];
    const ov = olderById.get(tr.case_id)?.[worst];
    return nv != null && ov != null && nv < ov;
  });
  if (causal) {
    if (worst === "precision") message += " — a new false positive slipped in";
    else if (worst === "recall") message += " — a case stopped being caught";
  }

  const others = METRIC_KEYS.filter((k) => k !== worst);
  if (others.every((k) => deltas[k] >= 0)) {
    const grew = others.filter((k) => deltas[k] > 0);
    message += grew.length > 0 ? ` · ${others.map((k) => METRIC_LABEL[k]).join(" and ")} both up` : " · stable";
  }

  return message;
}
