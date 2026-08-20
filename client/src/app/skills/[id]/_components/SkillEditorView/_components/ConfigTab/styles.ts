import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab. Mirrors the agent editor's `ConfigTab/
 *  styles.ts` (header/enabledLabel/actions/savedNote), plus the
 *  `untrustedNotice` banner carried over unchanged from `SkillDrawer/
 *  styles.ts` (same visual treatment, same trigger condition — AC-6). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  tokenCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  untrustedNotice: {
    background: "var(--bg-hover)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 10, marginTop: 10 } satisfies CSSProperties,
  savedNote: { alignSelf: "center", fontSize: 13, color: "var(--ok)" } satisfies CSSProperties,
} as const;
