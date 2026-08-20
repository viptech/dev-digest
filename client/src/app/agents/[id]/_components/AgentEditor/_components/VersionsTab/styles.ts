import type { CSSProperties } from "react";

/** Co-located styles for the agent-scoped VersionsTab. `diffBox`/`diffLine`
 *  mirror `skills/[id]/_components/SkillEditorView/_components/VersionsTab/
 *  styles.ts`'s exactly (same visual convention for a removed/added/unchanged
 *  line-level diff); `otherChanges*` is new here — agent versions snapshot
 *  more than one field, so a compact non-prompt change list sits alongside
 *  the prompt diff. */
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowLeft: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  createdAt: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  diffHeading: { fontSize: 13, fontWeight: 700, margin: "4px 0 8px" } satisfies CSSProperties,
  diffBox: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    maxHeight: 320,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  diffLine: (status: "removed" | "added" | "unchanged"): CSSProperties => ({
    color: status === "removed" ? "var(--crit)" : status === "added" ? "var(--ok)" : "var(--text-primary)",
    background: status === "removed" ? "var(--crit-bg)" : status === "added" ? "var(--ok-bg)" : "transparent",
    whiteSpace: "pre-wrap",
  }),
  otherChangesHeading: { fontSize: 13, fontWeight: 700, margin: "4px 0 8px" } satisfies CSSProperties,
  otherChangesList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  // `VersionDetailModal` — full text of one version, opened via the row's
  // "View" action.
  modalBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  modalSectionHeading: { fontSize: 13, fontWeight: 700, margin: "0 0 8px" } satisfies CSSProperties,
  promptBox: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    maxHeight: 320,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  configList: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  configRow: { display: "flex", gap: 8, fontSize: 13 } satisfies CSSProperties,
  configRowLabel: { color: "var(--text-secondary)", minWidth: 140 } satisfies CSSProperties,
  configRowValue: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  modalFooter: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
