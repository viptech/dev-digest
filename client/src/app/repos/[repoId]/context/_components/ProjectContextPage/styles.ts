import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextPage — mirrors ConventionsView's shape. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1200, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  layout: { display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  listRow: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
  }),
  listPath: { fontSize: 13, fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  detail: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 20,
    background: "var(--bg-elevated)",
    minHeight: 320,
  } satisfies CSSProperties,
  detailHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 } satisfies CSSProperties,
  detailPath: { fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  // Wrapper pushes the whole (agents + skills) count group right; each
  // individual count span stays plain, no marginLeft of its own.
  usedByGroup: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
  usedBy: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
