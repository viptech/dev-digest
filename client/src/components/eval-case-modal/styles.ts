import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal — two-column layout (left: name +
 *  diff/PR-meta/files tabs; right: expected-output JSON editor + run
 *  status). Promoted to the shared components layer (SPEC-05 T13): once
 *  `FindingsPanel` (repos/pulls feature) needed to render this modal too,
 *  alongside its original caller `EvalsTab` (agents feature), it stopped
 *  being one feature's private component — react-ui-architecture's "promote
 *  on the second user" rule. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  columns: { display: "flex", gap: 20 } satisfies CSSProperties,
  errorNotice: {
    color: "var(--crit)",
    fontSize: 12,
    padding: "6px 0",
  } satisfies CSSProperties,
  expectedHeaderRight: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  runBanner: (pass: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: pass ? "var(--ok)" : "var(--crit)",
    background: pass ? "var(--ok-bg)" : "var(--crit-bg)",
    marginTop: 16,
  }),
  /** POSITIVE/NEGATIVE CASE summary — a prominent bordered card at the top
   *  of the left column (matches the reference course video's layout: a
   *  standalone card above Name, not an inline row next to the run
   *  banner). */
  summaryCard: (kind: "must_find" | "must_not_flag"): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 8,
    marginBottom: 16,
    border: `1px solid ${kind === "must_find" ? "var(--accent)" : "var(--warn)"}`,
    background: kind === "must_find" ? "var(--accent-bg, var(--bg-surface))" : "var(--warn-bg, var(--bg-surface))",
  }),
  summaryCardLabel: (kind: "must_find" | "must_not_flag"): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: kind === "must_find" ? "var(--accent)" : "var(--warn)",
    marginBottom: 4,
  }),
  summaryCardText: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  actualOutputWrap: { marginTop: 12 } satisfies CSSProperties,
  actualOutputPre: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    maxHeight: 240,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  filesList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 0",
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  runOnSaveRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
