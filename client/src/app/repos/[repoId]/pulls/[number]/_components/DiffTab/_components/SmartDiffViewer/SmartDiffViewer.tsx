"use client";

import React from "react";
import { Icon, Badge } from "@devdigest/ui";
import { FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { useSmartDiff } from "@/lib/hooks/reviews";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { ROLE_LABEL, ROLE_DESCRIPTION, ROLE_DEFAULT_EXPANDED, ROLE_ICON } from "./constants";
import { s, chevronFor } from "./styles";

interface SmartDiffViewerProps {
  prId: string | null;
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** A finding badge was clicked — the parent switches to the Findings tab
   *  and expands that finding's card there. */
  onOpenFinding?: (findingId: string) => void;
}

/**
 * Smart Diff — groups a PR's already-imported files by risk role
 * (core/wiring/boilerplate), joining in the latest review's findings.
 * `core`/`wiring` start expanded, `boilerplate` starts collapsed. A clickable
 * "N findings" badge jumps to that file's first finding's card in the
 * Findings tab (via `onOpenFinding`) — the diff view itself doesn't own a
 * findings UI, so scrolling within it isn't the right destination.
 */
export function SmartDiffViewer({ prId, files, commenting, onOpenFinding }: SmartDiffViewerProps) {
  const { data: smartDiff, isLoading, isError } = useSmartDiff(prId);
  const [expanded, setExpanded] = React.useState<Record<SmartDiffRole, boolean>>({
    ...ROLE_DEFAULT_EXPANDED,
  });

  const fileByPath = React.useMemo(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  if (isLoading) return <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading smart order…</div>;
  if (isError || !smartDiff) {
    return <div style={{ padding: 24, color: "var(--text-muted)" }}>Couldn't load Smart Diff.</div>;
  }

  return (
    <div style={s.wrap}>
      {smartDiff.groups.map((group) => {
        const isOpen = expanded[group.role];
        const RoleIcon = Icon[ROLE_ICON[group.role]];
        return (
          <div key={group.role} style={s.group}>
            <div
              style={s.groupHeader}
              onClick={() => setExpanded((prev) => ({ ...prev, [group.role]: !prev[group.role] }))}
              role="button"
              aria-expanded={isOpen}
            >
              <Icon.ChevronRight size={13} style={chevronFor(isOpen)} />
              <RoleIcon size={15} style={{ color: "var(--text-muted)" }} />
              <div style={s.groupTitleWrap}>
                <span style={s.groupTitle}>
                  {ROLE_LABEL[group.role]} · {group.files.length} {group.files.length === 1 ? "file" : "files"}
                </span>
                <span style={s.groupDescription}>{ROLE_DESCRIPTION[group.role]}</span>
              </div>
            </div>
            {isOpen && (
              <div style={s.groupBody}>
                {group.files.map((sdFile) => {
                  const prFile = fileByPath.get(sdFile.path);
                  if (!prFile) return null;
                  return (
                    <FileCard
                      key={sdFile.path}
                      file={prFile}
                      commenting={commenting}
                      findings={sdFile.findings}
                      onOpenFinding={onOpenFinding}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {smartDiff.split_suggestion.too_big && (
        <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
          This PR is large ({smartDiff.split_suggestion.total_lines} lines changed) — consider splitting it into{" "}
          {smartDiff.split_suggestion.proposed_splits.length} smaller PRs.
        </Badge>
      )}
    </div>
  );
}
