import type { CSSProperties } from "react";

export const s = {
  anchor: { position: "relative", display: "inline-flex" } satisfies CSSProperties,
  card: {
    position: "fixed",
    zIndex: 50,
    minWidth: 260,
    maxWidth: 360,
    // Safety net alongside FindingsTooltip.tsx's `show()` viewport-clamping:
    // even with the up/down flip, an anchor with limited room on BOTH sides
    // (e.g. mid-viewport with many sibling cards) could still make a 4+
    // finding card taller than available space — clip and scroll internally
    // rather than ever painting past the viewport edge.
    maxHeight: "80vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 10,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  header: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    paddingBottom: 6,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  itemLast: { display: "flex", flexDirection: "column", gap: 3 } satisfies CSSProperties,
  itemTitleRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  itemTitle: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  itemMeta: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  itemLoc: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  itemDescription: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
};
