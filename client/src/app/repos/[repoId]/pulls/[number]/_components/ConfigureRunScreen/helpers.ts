/** Formats an `avg_latency_ms`-shaped estimate for the Configure run screen's
 *  time estimate (AC-7). `null` (no checked agent has run history) renders
 *  "—", matching `formatUsd`'s null convention (`@/components/run-cost-badge`). */
export function formatEstimatedTime(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
