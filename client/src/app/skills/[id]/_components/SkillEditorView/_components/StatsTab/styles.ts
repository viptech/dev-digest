import type { CSSProperties } from "react";

/** Co-located styles for the skill-scoped StatsTab. Mirrors the agent
 *  editor's `StatsTab/styles.ts` (tiles/panels/panel/panelTitle), minus the
 *  run-history table this tab doesn't render. */
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 14 } satisfies CSSProperties,
  panels: { display: "flex", gap: 20, flexWrap: "wrap" } satisfies CSSProperties,
  panel: {
    flex: "1 1 320px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  panelTitle: { fontSize: 13, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  emptyNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
};
