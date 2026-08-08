import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  // Copies PrDetailHeader's `staleBanner` style shape (same warn-icon +
  // muted-text pattern) — no shared component to import for this, it's a
  // plain style object there too.
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  empty: {
    padding: 24,
    color: "var(--text-muted)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  summary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    padding: "2px 2px 4px",
  } satisfies CSSProperties,
  // Level 1 — one group per changed symbol.
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
  // Level 2 — "Callers" / "Endpoints & crons affected" subsections.
  subGroup: {
    border: "1px solid var(--border)",
    borderRadius: 6,
  } satisfies CSSProperties,
  subGroupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    cursor: "pointer",
    userSelect: "none",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  subGroupBody: {
    borderTop: "1px solid var(--border)",
    padding: "6px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  // Level 3 — individual caller / endpoint leaf rows.
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "3px 0",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the group is expanded (mirrors SmartDiffViewer). */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
