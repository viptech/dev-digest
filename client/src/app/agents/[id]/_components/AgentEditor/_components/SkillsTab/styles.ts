import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
  row: (enabled: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 6,
    background: "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
  }),
  name: { fontSize: 13, fontWeight: 600, flex: 1 } satisfies CSSProperties,
} as const;
