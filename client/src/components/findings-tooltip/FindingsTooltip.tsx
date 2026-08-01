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
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  if (findings.length === 0) return <>{children}</>;

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
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
          <div role="tooltip" style={{ ...s.card, top: pos.top, left: pos.left }}>
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
