import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 6,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  resultBadge: (pass: boolean): CSSProperties => ({
    color: pass ? "var(--ok)" : "var(--crit)",
  }),
  rowError: {
    color: "var(--crit)",
    fontSize: 12,
    padding: "0 12px",
  } satisfies CSSProperties,
} as const;
