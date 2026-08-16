/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  focusFile,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** SPEC-04 T10 — Review Focus click target, plain passthrough to the ONE
     matching FileCard's `focus` prop. "Original order" gets the same
     wiring as Smart Diff for parity: a review-focus click should work
     regardless of which order the user has selected. */
  focusFile?: { path: string; line: number | null; n: number } | null;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          focus={f.path === focusFile?.path ? { line: focusFile.line, n: focusFile.n } : null}
        />
      ))}
    </div>
  );
}
