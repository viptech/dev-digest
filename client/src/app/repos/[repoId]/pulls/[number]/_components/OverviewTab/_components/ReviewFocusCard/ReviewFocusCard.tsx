"use client";

import React from "react";
import type { ReviewFocusItem } from "@devdigest/shared";
import { SectionLabel, Badge } from "@devdigest/ui";
import { s } from "./styles";

interface ReviewFocusCardProps {
  /** `Brief.review_focus` — already grounded (SPEC-04 AC-6: every item's
   *  `path` is confirmed to be a real changed file before this component
   *  ever sees it). `undefined`/empty renders nothing, same "nothing to
   *  show yet" convention `BlastRadiusCard`/`PrBriefCard` already follow. */
  reviewFocus?: ReviewFocusItem[];
  onOpenFile?: (path: string, line?: number | null) => void;
}

/**
 * "Review Focus — read these first" (SPEC-04 AC-19/AC-20) — a full-width
 * card below Blast Radius, one clickable row per `review_focus` item.
 * Clicking a row switches the PR-detail page to Files changed, scrolled/
 * highlighted to that exact file (and line, if known) — wired through
 * `page.tsx`'s `onOpenFile`/`focusFile` state down to `FileCard`'s new
 * `focus` prop.
 */
export function ReviewFocusCard({ reviewFocus, onOpenFile }: ReviewFocusCardProps) {
  if (!reviewFocus || reviewFocus.length === 0) return null;

  return (
    <section>
      <SectionLabel
        icon="ListChecks"
        right={<Badge>{reviewFocus.length}</Badge>}
      >
        Review focus — read these first
      </SectionLabel>
      <div style={s.card}>
        {reviewFocus.map((item, i) => (
          <div
            key={`${item.path}:${item.line ?? ""}:${i}`}
            style={{ ...s.row, borderTop: i === 0 ? "none" : s.row.borderTop }}
            onClick={() => onOpenFile?.(item.path, item.line)}
            role="button"
          >
            <span className="mono" style={s.path}>
              {item.path}
              {item.line != null ? `:${item.line}` : ""}
            </span>
            <span style={s.note}>— {item.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
