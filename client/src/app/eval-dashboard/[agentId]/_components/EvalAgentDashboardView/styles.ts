import type { CSSProperties } from "react";

/** Co-located styles for EvalAgentDashboardView (SPEC-05 T15). */
export const s = {
  page: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" } satisfies CSSProperties,

  banner: {
    fontSize: 13,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
  } satisfies CSSProperties,

  metricsRow: { display: "flex", gap: 12, marginBottom: 24 } satisfies CSSProperties,
  metricCard: {
    flex: 1,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 16px",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  metricCardLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  metricCardValueRow: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 } satisfies CSSProperties,
  metricCardValue: (color: string): CSSProperties => ({ fontSize: 22, fontWeight: 700, color }),
  metricCardDelta: (up: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: up ? "var(--ok)" : "var(--crit)",
  }),

  sectionHeadingWrap: { marginTop: 8, marginBottom: 12 } satisfies CSSProperties,
  chartWrap: { marginBottom: 24 } satisfies CSSProperties,

  historyTable: { border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" } satisfies CSSProperties,
  historyHeaderRow: {
    display: "grid",
    gridTemplateColumns: "24px 60px 1fr 90px 90px 90px 90px",
    alignItems: "center",
    gap: 12,
    padding: "8px 14px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  historyRow: {
    display: "grid",
    gridTemplateColumns: "24px 60px 1fr 90px 90px 90px 90px",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  historyVersion: { color: "var(--accent)", fontWeight: 600 } satisfies CSSProperties,
  historyMeta: { color: "var(--text-muted)" } satisfies CSSProperties,

  compareBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  } satisfies CSSProperties,
} as const;
