import type { CSSProperties } from "react";

export const s = {
  results: {
    marginTop: 4,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,
  viewSwitch: {
    display: "flex",
    gap: 4,
  } satisfies CSSProperties,
  disagreeWrap: {
    marginTop: 8,
  } satisfies CSSProperties,
} as const;
