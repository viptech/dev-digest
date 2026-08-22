import type { CSSProperties } from "react";

/** Co-located styles for the ExportWizard shell (step indicator + footer).
 *  Each step has its own colocated `styles.ts` for its body content. */
export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,
  stepsRow: { marginBottom: 22 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 } satisfies CSSProperties,
  footerRight: { display: "flex", gap: 10 } satisfies CSSProperties,
  errorNote: {
    marginTop: 12,
    fontSize: 12.5,
    color: "var(--crit)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
} as const;
