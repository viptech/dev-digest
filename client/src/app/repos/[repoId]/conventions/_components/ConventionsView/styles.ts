import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView — mirrors the page/header/search/grid
 *  shape the now-deleted `SkillsListView` grid used to have (SPEC-06
 *  replaced that page with `/skills` redirecting straight into the Skill
 *  Editor's sidebar; this page's own shape is unaffected). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
