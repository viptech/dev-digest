import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    cursor: "pointer",
    fontSize: 13,
  } satisfies CSSProperties,
  path: {
    color: "var(--accent-text)",
    flexShrink: 0,
  } satisfies CSSProperties,
  note: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
