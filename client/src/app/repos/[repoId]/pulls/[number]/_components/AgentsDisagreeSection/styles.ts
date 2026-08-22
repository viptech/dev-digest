import type { CSSProperties } from "react";

/** Co-located styles for AgentsDisagreeSection (SPEC-07 T13). */
export const s = {
  toggleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  clusterCard: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  clusterHeader: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
  } satisfies CSSProperties,
  agentName: {
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 130,
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  statusText: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  matchList: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  matchItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
