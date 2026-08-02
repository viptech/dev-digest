import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
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
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 } satisfies CSSProperties,
  th: { textAlign: "left", color: "var(--text-muted)", padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  td: { padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
};
