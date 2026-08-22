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
  findingRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  findingTitleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  findingTitle: {
    flex: 1,
    minWidth: 0,
    wordBreak: "break-word",
  } satisfies CSSProperties,
  findingLoc: {
    fontSize: 11,
    color: "var(--text-muted)",
    // On its own row below the title (not competing with it for the same
    // row's width) — coordinator fix: the previous single-row layout gave
    // this span `flexShrink: 0` with no width cap, so a long file path
    // claimed its full unwrapped monospace width, squeezed `findingTitle`
    // (flex:1, minWidth:0) down to near-zero — wrapping the title one word
    // per line — AND overflowed past the column's own right edge into the
    // next column, since nothing clipped it. Truncating in its own
    // full-width row fixes both: the title always gets the column's full
    // width, and a long path/line ellipsizes instead of spilling out.
    marginLeft: 18, // aligns under the title, past the severity icon
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
