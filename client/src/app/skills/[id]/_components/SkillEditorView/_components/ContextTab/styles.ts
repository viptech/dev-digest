import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. `serializesAs*` values moved verbatim
 *  from `SkillDrawer/styles.ts` (Step 7.3, AC-10) — same visual treatment
 *  as before the block lived in the drawer's "edit" mode. */
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  serializesAs: { marginTop: 16 } satisfies CSSProperties,
  serializesAsLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  } satisfies CSSProperties,
  serializesAsCode: {
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    margin: 0,
    whiteSpace: "pre-wrap",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
