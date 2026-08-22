import type { CSSProperties } from "react";

/** Co-located styles for TabsDetailView (SPEC-07 T12). */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  tabBar: {
    display: "flex",
    gap: 4,
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  tab: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
  errorText: {
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,
  summaryRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  summaryText: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  findingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
