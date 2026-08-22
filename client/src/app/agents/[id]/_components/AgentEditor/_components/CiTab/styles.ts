import type { CSSProperties } from "react";

/** Co-located styles for CiTab. Mirrors StatsTab's panel/table conventions
 *  (`StatsTab/styles.ts`) so the CI tab's installations/run-history lists
 *  read consistently with the rest of the editor. */
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  failRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  failValue: { fontWeight: 700, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  panelTitle: { fontSize: 13, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  installRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  installRepo: { fontFamily: "var(--font-mono)", fontWeight: 600 } satisfies CSSProperties,
  installMeta: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 } satisfies CSSProperties,
  th: { textAlign: "left", color: "var(--text-muted)", padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  td: { padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  traceLink: { color: "var(--accent)", fontSize: 12, textDecoration: "underline" } satisfies CSSProperties,
} as const;
