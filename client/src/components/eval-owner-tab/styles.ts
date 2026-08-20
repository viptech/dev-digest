import type { CSSProperties } from "react";

/** Co-located styles for `EvalOwnerTab` (moved verbatim from
 *  `agents/[id]/.../EvalsTab/styles.ts`, Development Plan `skill-editor.md`
 *  Step 5, SPEC-06 AC-17 — no visual changes). */
export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 6,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  resultBadge: (pass: boolean): CSSProperties => ({
    color: pass ? "var(--ok)" : "var(--crit)",
  }),
  rowError: {
    color: "var(--crit)",
    fontSize: 12,
    padding: "0 12px",
  } satisfies CSSProperties,

  // ---- Metrics-card block (mockup header, above the case list) ----------
  metricsSectionHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  } satisfies CSSProperties,
  dashboardLink: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    marginBottom: 6,
  } satisfies CSSProperties,
  metricCard: {
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  metricCardLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 4,
  } satisfies CSSProperties,
  metricCardValue: (color: string): CSSProperties => ({ fontSize: 20, fontWeight: 700, color }),
  // Reuses the existing Compare section's `up ? "var(--ok)" : "var(--crit)"`
  // convention (EvalOwnerTab.tsx's comparison block) for the delta arrow.
  metricCardDelta: (up: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: up ? "var(--ok)" : "var(--crit)",
    marginTop: 2,
  }),
  metricsCaption: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 20,
  } satisfies CSSProperties,

  // ---- Eval cases section header -----------------------------------------
  casesHeading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  casesCountMuted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  passingBadge: {
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,

  // ---- Case row (enriched, mockup-aligned) -------------------------------
  caseRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 6,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  caseStatusIcon: (pass: boolean | null): CSSProperties => ({
    color: pass == null ? "var(--text-muted)" : pass ? "var(--ok)" : "var(--crit)",
    flexShrink: 0,
    marginTop: 2,
  }),
  caseNameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  caseSubtitle: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  // `Badge`'s `style` prop override (no new component needed) — a bordered,
  // transparent-background variant for the MUST FIND/MUST NOT FLAG badge,
  // distinct from the filled result badges above.
  mustFindBadge: {
    border: "1px solid var(--accent)",
    background: "transparent",
    color: "var(--accent)",
  } satisfies CSSProperties,
  mustNotFlagBadge: {
    border: "1px solid var(--border-strong)",
    background: "transparent",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  caseTag: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  caseActions: { display: "flex", gap: 4, flexShrink: 0, marginLeft: "auto" } satisfies CSSProperties,
} as const;
