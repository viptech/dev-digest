import type { CSSProperties } from "react";

export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMeta: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  rowName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rowModel: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  rowStats: {
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
    textAlign: "right",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  estimates: {
    display: "flex",
    gap: 20,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
} as const;
