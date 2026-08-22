import type { CSSProperties } from "react";

export const s = {
  successWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0", textAlign: "center" } satisfies CSSProperties,
  successIcon: { color: "var(--ok)" } satisfies CSSProperties,
  successTitle: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  successBody: { fontSize: 13, color: "var(--text-secondary)", maxWidth: 400 } satisfies CSSProperties,
} as const;
