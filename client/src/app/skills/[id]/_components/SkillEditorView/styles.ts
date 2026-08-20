import type { CSSProperties } from "react";

/** Co-located styles for the SkillEditorView shell. Two-pane layout — left:
 *  sibling skill list + search + "Add Skill", right: the tabbed editor —
 *  mirroring `AgentEditorPage.tsx`'s left-sidebar pattern (`width: 280`,
 *  `borderRight`, `AgentCard` list) with `SkillCard`/`filterSkills` in place
 *  of `AgentCard`/agent filtering. An earlier version of this route shipped
 *  without this sidebar (the Development Plan read the spec's silence on it
 *  as "not called for"); course feedback against the reference mockup
 *  corrected that — the mockup shows the same list+switch affordance
 *  `AgentEditor` has, so this route keeps it too. */
export const s = {
  wrap: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,

  sidebar: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  sidebarHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  sidebarHeaderRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  sidebarHeading: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  sidebarSearch: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-base)",
  } satisfies CSSProperties,
  sidebarSearchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  sidebarSearchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  sidebarList: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,

  mainLoading: { flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 0", flexShrink: 0 } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
