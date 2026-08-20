/** Metric color convention (SPEC-05 T14) — recall=blue, precision=green,
 *  citation_accuracy=amber, matching the reference dashboard mockup and
 *  reused consistently across the sparkline, the metric numbers, and the
 *  history table's progress bars. No prior convention existed for these
 *  three metrics elsewhere in the app (client/INSIGHTS.md 2026-08-19).
 *
 *  Promoted here from `eval-dashboard/_components/EvalDashboardView/styles.ts`
 *  (Development Plan evals-tab-mockup-alignment.md) — `EvalsTab` becoming a
 *  second consumer, from a different feature tree, is the "promote on the
 *  second user" trigger (client/INSIGHTS.md 2026-08-19 decision, same rule
 *  that already promoted `EvalCaseModal`). This is now the ONE sanctioned
 *  color mapping for these metrics — reuse it, don't invent a second
 *  palette. */
export const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation_accuracy: "var(--warn)",
} as const;
