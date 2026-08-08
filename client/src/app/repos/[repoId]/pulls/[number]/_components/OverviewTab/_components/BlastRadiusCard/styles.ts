import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } satisfies CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  countItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  viewToggle: {
    display: "flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  viewToggleBtn: {
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 11.5,
    padding: "4px 10px",
    cursor: "pointer",
  } satisfies CSSProperties,
  viewToggleBtnActive: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
  body: {
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "10px 10px 0",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  empty: {
    padding: "16px 10px",
    color: "var(--text-muted)",
    fontSize: 13,
  } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,
  groupTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--info)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  groupCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  groupBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 10px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "2px 0",
  } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 4,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the group is expanded (mirrors SmartDiffViewer/BlastTab). */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
