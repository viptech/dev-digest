import type { CSSProperties } from "react";

export const s = {
  row: (checked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid " + (checked ? "var(--accent)" : "var(--border)"),
    background: checked ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "pointer",
    marginBottom: 8,
  }),
  circle: (checked: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: 99,
    flexShrink: 0,
    marginTop: 2,
    border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
    display: "grid",
    placeItems: "center",
  }),
  dot: { width: 8, height: 8, borderRadius: 99, background: "var(--accent)" } satisfies CSSProperties,
  textCol: { display: "flex", flexDirection: "column", gap: 3, flex: 1 } satisfies CSSProperties,
  labelRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  label: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 } satisfies CSSProperties,
} as const;
