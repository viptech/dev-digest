import type { CSSProperties } from "react";

/** Promoted to `@/lib/eval-metrics` (Development Plan
 *  evals-tab-mockup-alignment.md) once `EvalsTab` became a second consumer
 *  from a different feature tree — re-exported here so this file's existing
 *  `import { s, METRIC_COLOR } from "./styles"` in `EvalDashboardView.tsx`
 *  keeps working unchanged. */
export { METRIC_COLOR } from "@/lib/eval-metrics";

/** Co-located styles for EvalDashboardView. */
export const s = {
  page: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  header: {} satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" } satisfies CSSProperties,
  sectionHeadingWrap: { marginTop: 28 } satisfies CSSProperties,
  warnNotice: {
    fontSize: 12,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: "8px 12px",
    marginBottom: 12,
  } satisfies CSSProperties,

  card: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 8,
    background: "var(--bg-elevated)",
    cursor: "pointer",
  } satisfies CSSProperties,
  cardMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  cardNameRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 2 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  sparklineWrap: { flexShrink: 0 } satisfies CSSProperties,
  metricsGroup: { display: "flex", gap: 18, flexShrink: 0 } satisfies CSSProperties,
  metricCol: { display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 56 } satisfies CSSProperties,
  metricLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: "var(--text-muted)" } satisfies CSSProperties,
  metricValue: (color: string): CSSProperties => ({ fontSize: 16, fontWeight: 700, color }),
  cardChevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  historyTable: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  historyRow: {
    display: "grid",
    gridTemplateColumns: "1fr 130px 40px 120px 120px 120px 70px",
    alignItems: "center",
    gap: 14,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  historyAgent: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  historyMeta: { color: "var(--text-muted)" } satisfies CSSProperties,
  historyVersion: { color: "var(--accent)", fontWeight: 600 } satisfies CSSProperties,
  historyPassCount: { fontWeight: 700, textAlign: "right" } satisfies CSSProperties,
  barCell: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  barTrack: { flex: 1, height: 6, background: "var(--bg-hover)", borderRadius: 3, overflow: "hidden" } satisfies CSSProperties,
  barFill: (pct: number, color: string): CSSProperties => ({
    width: `${pct}%`,
    height: "100%",
    background: color,
    borderRadius: 3,
  }),
  barPct: { fontSize: 12, fontWeight: 600, minWidth: 32, textAlign: "right" } satisfies CSSProperties,
} as const;
