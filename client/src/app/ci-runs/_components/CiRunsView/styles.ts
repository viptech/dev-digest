import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. Mirrors `EvalDashboardView/styles.ts`'s
 *  page/headerRow/h1/subtitle shape (same "global workspace-wide page"
 *  family) and `CiTab/styles.ts`'s table/th/td conventions (same data —
 *  this page is the un-scoped superset of that tab's mini table). */
export const s = {
  page: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 } satisfies CSSProperties,
  autoRefreshRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,

  filtersRow: { display: "flex", flexWrap: "wrap", gap: 10 } satisfies CSSProperties,
  filterSelect: { minWidth: 150 } satisfies CSSProperties,

  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: { textAlign: "left", color: "var(--text-muted)", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" } satisfies CSSProperties,
  td: { padding: "8px 12px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  traceLink: { color: "var(--accent)", fontSize: 12, textDecoration: "underline" } satisfies CSSProperties,

  findingsCell: { display: "flex", gap: 8, fontFamily: "var(--font-mono)", fontSize: 12 } satisfies CSSProperties,
  findingsCritical: { color: "var(--crit)", fontWeight: 700 } satisfies CSSProperties,
  findingsWarning: { color: "var(--warn)", fontWeight: 700 } satisfies CSSProperties,
  findingsSuggestion: { color: "var(--sugg)", fontWeight: 700 } satisfies CSSProperties,
} as const;
