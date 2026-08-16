/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, Severity, SmartDiffFinding } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Highest-severity-wins ordering for when a line has more than one finding. */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** Smart Diff — new-line-number → worst severity, for CodeLine's inline badge. */
function findingByLine(findings: SmartDiffFinding[] | undefined): Map<number, Severity> {
  const m = new Map<number, Severity>();
  if (!findings) return m;
  for (const f of findings) {
    const existing = m.get(f.line);
    if (!existing || SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing]) m.set(f.line, f.severity);
  }
  return m;
}

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  scrollToLine,
  focus,
  findings,
  onOpenFinding,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Smart Diff's clickable "N findings" badge — the new-side line number to
     scroll this card open to and highlight. Forces the card open even if it
     would otherwise auto-collapse (large file). Declared/consumed since this
     component's original build, but no caller has ever passed it — kept as
     its own, independent mechanism, not repurposed for SPEC-04's `focus`
     below (which has different semantics: a nullable `line`, and a nonce
     for repeat-click re-triggering that `scrollToLine` never needed). */
  scrollToLine?: number | null;
  /** SPEC-04 (T10) Review Focus click target — file-level scroll/open,
     independent of `scrollToLine`. `line: null` still force-opens and
     scrolls to the CARD itself, just highlights no individual line (a
     path-only `review_focus` item, the correct degrade). `n` is an
     incrementing nonce so a second click on the SAME target re-triggers
     the scroll even though every other field is identical. */
  focus?: { line: number | null; n: number } | null;
  /** Smart Diff — this file's findings (line + severity), rendered as an
     inline badge on each matching line. */
  findings?: SmartDiffFinding[];
  /** Smart Diff — clicking the header's "N findings" badge jumps to that
     finding's card in the Findings tab. */
  onOpenFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const cardRef = React.useRef<HTMLDivElement>(null);
  // A finding badge click always wants to see the line, regardless of the
  // file's auto-expand default.
  React.useEffect(() => {
    if (scrollToLine != null) setOpen(true);
  }, [scrollToLine]);
  // SPEC-04 T10 — independent of the effect above. Force-open + scroll the
  // CARD itself into view regardless of whether `focus.line` is known (the
  // `CodeLine`-level highlight below only fires when it is). Keyed on the
  // NONCE, not on `focus`/`focus.line`, so a repeat click on the same
  // file+line still re-scrolls.
  React.useEffect(() => {
    if (focus && cardRef.current) {
      setOpen(true);
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const findingByLineMap = React.useMemo(() => findingByLine(findings), [findings]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div ref={cardRef} style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {findings && findings.length > 0 && (
          <button
            type="button"
            style={s.findingsBadgeBtn}
            onClick={(e) => {
              e.stopPropagation(); // don't also toggle the card open/closed
              onOpenFinding?.(findings[0]!.id);
            }}
          >
            <Icon.AlertTriangle size={12} />
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </button>
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                highlight={
                  (scrollToLine != null && ln.newNo === scrollToLine) ||
                  (focus?.line != null && ln.newNo === focus.line)
                }
                focusNonce={focus?.n}
                finding={ln.newNo != null ? findingByLineMap.get(ln.newNo) : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
