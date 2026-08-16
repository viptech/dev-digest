import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM.
 *
 *  Typography comes from `@tailwindcss/typography`'s `.prose` class, not
 *  hand-rolled per-element `components` overrides — every remark-gfm
 *  construct (nested lists, tables, task lists, footnotes, fenced code)
 *  gets correct, consistent typography for free. The `.dd-md` class (see
 *  `vendor/ui/styles.css`) maps `.prose`'s `--tw-prose-*` variables onto
 *  this app's own theme tokens, so light/dark just falls out of the
 *  existing `[data-theme]` mechanism — no separate `.prose-invert` wiring. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
