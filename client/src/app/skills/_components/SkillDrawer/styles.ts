import type { CSSProperties } from "react";

/** Co-located styles for SkillDrawer. */
export const s = {
  body: { padding: "20px 24px", overflow: "auto" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  dropzone: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    padding: 24,
    textAlign: "center",
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  untrustedNotice: {
    background: "var(--bg-hover)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,
} as const;
