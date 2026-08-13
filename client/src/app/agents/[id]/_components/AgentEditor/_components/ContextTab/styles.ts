import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. */
export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,
  aggregateRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  } satisfies CSSProperties,
  aggregateBreakdown: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
