import type { CSSProperties } from "react";

/** Co-located styles for the SkillEditorView shell. Mirrors
 *  `AgentEditor/styles.ts` plus a small header row (this route has no
 *  agent-editor-style sibling sidebar, per SPEC-06 — the header carries the
 *  name/version/enabled chrome instead). */
export const s = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 0" } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
