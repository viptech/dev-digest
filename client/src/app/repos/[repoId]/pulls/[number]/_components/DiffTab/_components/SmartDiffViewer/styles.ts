import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,
  groupTitleWrap: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } satisfies CSSProperties,
  groupTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupDescription: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupBody: {
    borderTop: "1px solid var(--border)",
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toggleRow: { display: "inline-flex", gap: 4 } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the group is expanded. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
