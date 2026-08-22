import type { CSSProperties } from "react";

/** Co-located styles for ColumnsView (SPEC-07 T11). */
export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  columnHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  columnHeaderMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  } satisfies CSSProperties,
  agentName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  model: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  errorText: {
    fontSize: 12,
    color: "var(--crit)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  // Compact per-severity count badges (replaces an earlier per-finding list
  // — coordinator fix per user feedback: several findings made the column
  // tall/cluttered, and the file:line text had its own overflow bug). Same
  // shape as `RunHistory`'s own severity badges, colocated as its own style
  // here rather than shared, since the two components' surrounding layout
  // differs enough that sharing wouldn't simplify either.
  severityBadges: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  severityBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 12,
    borderBottom: "1px dotted currentColor",
    paddingBottom: 2,
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
