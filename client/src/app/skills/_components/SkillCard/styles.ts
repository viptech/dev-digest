import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
    cursor: "pointer",
    opacity: enabled ? 1 : 0.6,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
} as const;
