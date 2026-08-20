import type { CSSProperties } from "react";

/** Co-located styles for the skill-scoped VersionsTab. `diffBox`/`diffLine`
 *  mirror `CompareRunsModal/styles.ts`'s exactly (same visual convention for
 *  a removed/added/unchanged line-level diff). */
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowLeft: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  createdAt: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  diffHeading: { fontSize: 13, fontWeight: 700, margin: "4px 0 8px" } satisfies CSSProperties,
  diffBox: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    maxHeight: 320,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  diffLine: (status: "removed" | "added" | "unchanged"): CSSProperties => ({
    color: status === "removed" ? "var(--crit)" : status === "added" ? "var(--ok)" : "var(--text-primary)",
    background: status === "removed" ? "var(--crit-bg)" : status === "added" ? "var(--ok-bg)" : "transparent",
    whiteSpace: "pre-wrap",
  }),
} as const;
