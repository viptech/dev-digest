import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  intentText: {
    margin: 0,
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  scopeBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  meta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  risksBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  risksLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  riskChip: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  riskChipHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
  } satisfies CSSProperties,
  riskChipTitle: {
    color: "var(--text-primary)",
    fontWeight: 600,
    flexShrink: 0,
  } satisfies CSSProperties,
  riskChipRef: {
    color: "var(--text-muted)",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  riskChipBody: {
    padding: "0 10px 10px 32px",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when a risk chip is expanded — own copy of the same
 *  visual pattern `BlastRadiusCard/styles.ts`/`SmartDiffViewer/styles.ts`
 *  each independently implement (not a shared export — cross-feature import
 *  would violate the folder-boundary rule; see SPEC-04 T9 cross-model
 *  review finding m3). */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}
