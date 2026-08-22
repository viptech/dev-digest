import type { CSSProperties } from "react";

export const s = {
  cards: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 } satisfies CSSProperties,
  card: (selectable: boolean, selected: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 16,
    borderRadius: 10,
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: selectable ? 1 : 0.5,
    cursor: selectable ? "pointer" : "not-allowed",
  }),
  cardIcon: (selected: boolean): CSSProperties => ({
    color: selected ? "var(--accent)" : "var(--text-muted)",
  }),
  cardLabel: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  cardDesc: { fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" } satisfies CSSProperties,
} as const;
