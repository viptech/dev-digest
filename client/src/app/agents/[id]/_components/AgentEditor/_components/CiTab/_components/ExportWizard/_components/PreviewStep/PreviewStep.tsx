"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Textarea, Badge } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { MEMORY_FILE_PATH } from "../../constants";
import { isEditableInPreview } from "../../helpers";
import { s } from "./styles";

/**
 * Preview step (G4/AC-7/AC-10/AC-12) — the 6 generated files, a file picker
 * on the left, and an inline editor on the right for every file except the
 * bundled runner (`editable: false`, whatever `agent-runner`'s build
 * actually produced — one or more files, never assumed to be exactly one)
 * and `.devdigest/memory.jsonl` (AC-10: shown as an explicit "empty" note,
 * never an empty editor pretending there's content to edit).
 */
export function PreviewStep({
  files,
  loading,
  selectedPath,
  onSelectPath,
  editedContents,
  onEditContent,
}: {
  files: CiFile[] | undefined;
  loading: boolean;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  editedContents: Record<string, string>;
  onEditContent: (path: string, value: string) => void;
}) {
  const t = useTranslations("ci");

  if (loading || !files) {
    return <div style={s.loading}>{t("exportWizard.generating")}</div>;
  }

  const selected = files.find((f) => f.path === selectedPath) ?? files[0];

  return (
    <div>
      <div style={s.fileListLabel}>{t("exportWizard.filesToCreate")}</div>
      <div style={s.layout}>
        <div style={s.fileList}>
          {files.map((f) => (
            <div key={f.path} style={s.fileItem(f.path === selected?.path)} onClick={() => onSelectPath(f.path)}>
              <span style={s.filePath}>{f.path}</span>
              <span style={s.fileBadge}>
                {f.editable ? t("exportWizard.editable") : t("exportWizard.notEditable")}
              </span>
            </div>
          ))}
        </div>

        <div style={s.editorCol}>
          {selected && (
            <>
              <div style={s.editorHeader}>
                <span style={s.editorPath}>{selected.path}</span>
                {!selected.editable && <Badge color="var(--text-muted)">{t("exportWizard.notEditable")}</Badge>}
              </div>
              {selected.path === MEMORY_FILE_PATH ? (
                <div style={s.placeholder}>{t("exportWizard.memoryEmpty")}</div>
              ) : isEditableInPreview(selected) ? (
                <Textarea
                  value={editedContents[selected.path] ?? selected.contents}
                  onChange={(v) => onEditContent(selected.path, v)}
                  rows={16}
                  mono
                />
              ) : (
                <div style={s.placeholder}>{t("exportWizard.notEditable")}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
