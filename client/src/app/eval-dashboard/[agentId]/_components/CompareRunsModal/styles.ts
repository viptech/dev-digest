import type { CSSProperties } from "react";

/** Co-located styles for CompareRunsModal (SPEC-05 T15). */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" } satisfies CSSProperties,
  sectionHeading: { fontSize: 13, fontWeight: 700, margin: "12px 0 8px" } satisfies CSSProperties,
  metricRow: {
    display: "grid",
    gridTemplateColumns: "140px 70px 20px 70px 90px",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    marginBottom: 4,
  } satisfies CSSProperties,
  metricLabel: { textTransform: "capitalize", color: "var(--text-muted)" } satisfies CSSProperties,
  delta: (up: boolean): CSSProperties => ({ color: up ? "var(--ok)" : "var(--crit)", fontWeight: 700 }),

  muted: { fontSize: 12, color: "var(--text-muted)", margin: "4px 0" } satisfies CSSProperties,
  diffBox: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  diffLine: (status: "removed" | "added" | "unchanged"): CSSProperties => ({
    color: status === "removed" ? "var(--crit)" : status === "added" ? "var(--ok)" : "var(--text-primary)",
    background: status === "removed" ? "var(--crit-bg)" : status === "added" ? "var(--ok-bg)" : "transparent",
    whiteSpace: "pre-wrap",
  }),

  promoteRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 16 } satisfies CSSProperties,
  errorNotice: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
} as const;
