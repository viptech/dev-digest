import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal — two-column layout (left: name +
 *  diff/PR-meta tabs; right: expected-output JSON editor). */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  columns: { display: "flex", gap: 20 } satisfies CSSProperties,
} as const;
