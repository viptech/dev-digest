import type { CSSProperties } from "react";

/** Co-located styles for ContextDocPicker. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6, background: "var(--bg-elevated)" } satisfies CSSProperties,
  path: { fontSize: 13, fontWeight: 600, flex: 1, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  repoTag: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  discoveryHeaderRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 8 } satisfies CSSProperties,
  budget: (warn: boolean): CSSProperties => ({
    fontSize: 12,
    color: warn ? "var(--warn)" : "var(--text-muted)",
  }),
} as const;
