"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Icon, SEV, ConfidenceNum, type Severity } from "@devdigest/ui";
import { s } from "./styles";

export interface TooltipFinding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  rationale: string;
}

// Typed as a literal tuple (not `Severity[]`, which also allows "INFO" via
// @devdigest/ui's wider Severity) so it stays assignable to the narrower
// 3-key `FindingsSummary.counts` object PRRow indexes with it.
export const SEVERITY_DISPLAY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"] as const satisfies readonly Severity[];

function locationLabel(f: TooltipFinding): string {
  return f.end_line !== f.start_line ? `${f.file}:${f.start_line}-${f.end_line}` : `${f.file}:${f.start_line}`;
}

export function FindingsTooltip({
  findings,
  children,
}: {
  findings: TooltipFinding[];
  children: React.ReactNode;
}) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [pos, setPos] = React.useState<{ top?: number; bottom?: number; left: number } | null>(null);

  if (findings.length === 0) return <>{children}</>;

  // Coordinator fix (reported live: the card grows tall with 4+ findings and
  // was overflowing past the bottom of the viewport, painting over whatever
  // content happened to sit below it on the page). `CARD_MAX_WIDTH` mirrors
  // `s.card`'s own `maxWidth: 360` — the actual rendered width is unknown
  // before paint, but never exceeds this, so it's a safe upper bound to
  // clamp against without a second measure-then-reposition render pass.
  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const CARD_MAX_WIDTH = 360;
    const MARGIN = 8;
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - CARD_MAX_WIDTH - MARGIN);
    // Below the anchor is the default; flip to growing UPWARD from the
    // anchor's top (anchored via `bottom`, not `top`, so the browser sizes
    // it without needing to know the content's height up front) whenever
    // there's markedly less room below than above — covers the common case
    // (an anchor in a PR's bottom-most row/section) without needing to
    // measure the card's actual height first.
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    setPos(
      flipUp
        ? { bottom: window.innerHeight - rect.top + 6, left }
        : { top: rect.bottom + 6, left },
    );
  };
  const hide = () => setPos(null);

  return (
    <span ref={anchorRef} style={s.anchor} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos &&
        createPortal(
          // Fixed + portaled to <body>: an ancestor row/card with `overflow:
          // hidden` (e.g. the PR list's rounded table card) would otherwise
          // clip an absolutely-positioned popover before it ever reaches the
          // viewport edge.
          <div
            role="tooltip"
            style={{ ...s.card, top: pos.top, bottom: pos.bottom, left: pos.left }}
            // The card is portaled to <body>, outside the anchor span's own
            // DOM subtree — without its own enter/leave handlers, moving the
            // cursor from the small badge down into the (now-scrollable,
            // per the viewport-clamp fix above) card crosses the anchor's
            // boundary and fires ITS onMouseLeave mid-transit, closing the
            // tooltip before a reader can ever reach it to scroll. Hovering
            // the card itself now keeps it open; leaving the card (in any
            // direction) closes it, same as leaving the anchor does.
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <div style={s.header}>
              {findings.length} finding{findings.length === 1 ? "" : "s"}
            </div>
            {findings.map((f, i) => {
              const SevIcon = Icon[SEV[f.severity].icon];
              return (
                <div key={f.id} style={i === findings.length - 1 ? s.itemLast : s.item}>
                  <div style={s.itemTitleRow}>
                    <SevIcon size={13} style={{ color: SEV[f.severity].c, flexShrink: 0 }} />
                    <span style={s.itemTitle}>{f.title}</span>
                  </div>
                  <div style={s.itemMeta}>
                    <span className="mono" style={s.itemLoc}>
                      {locationLabel(f)}
                    </span>
                    <ConfidenceNum value={f.confidence} />
                  </div>
                  <div style={s.itemDescription}>{f.rationale}</div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
