"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button } from "@devdigest/ui";
import type { CiExport } from "@devdigest/shared";
import { RadioRow } from "../RadioRow";
import type { InstallMethod } from "../../helpers";
import { s } from "./styles";

/**
 * Install step (G6/AC-18-AC-21) — "Open a PR" (default) vs "Copy files"
 * before submit; a success view after. `result.pr_url` distinguishes the
 * two outcomes the same `CiExport` shape can carry: non-null ⇒ a PR was
 * opened/reused (AC-19), `null` ⇒ the files-only path (AC-20, no GitHub
 * call, no `ci_installations` write) — the caller already triggered the
 * per-file downloads before setting `result` (see `ExportWizard.tsx`).
 */
export function InstallStep({
  repo,
  fileCount,
  installMethod,
  onInstallMethodChange,
  result,
}: {
  repo: string;
  fileCount: number;
  installMethod: InstallMethod;
  onInstallMethodChange: (v: InstallMethod) => void;
  result: CiExport | null;
}) {
  const t = useTranslations("ci");

  if (result) {
    const opened = result.pr_url != null;
    return (
      <div style={s.successWrap}>
        <Icon.CheckCircle size={36} style={s.successIcon} />
        <div style={s.successTitle}>
          {opened ? t("exportWizard.installedTitle") : t("exportWizard.filesDownloadedTitle")}
        </div>
        <div style={s.successBody}>
          {opened
            ? t("exportWizard.installedBody", { repo })
            : t("exportWizard.filesDownloadedBody", { count: fileCount })}
        </div>
        {opened && result.pr_url && (
          <Button kind="primary" icon="ExternalLink" onClick={() => window.open(result.pr_url!, "_blank", "noopener")}>
            {t("exportWizard.viewPr")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <RadioRow
        checked={installMethod === "open_pr"}
        onSelect={() => onInstallMethodChange("open_pr")}
        label={t("exportWizard.installCardTitle")}
        hint={t("exportWizard.installCardBody", { repo: repo || t("exportWizard.ownerRepo"), count: fileCount })}
      />
      <RadioRow
        checked={installMethod === "files"}
        onSelect={() => onInstallMethodChange("files")}
        label={t("exportWizard.zipCardTitle")}
        hint={t("exportWizard.zipCardBody", { count: fileCount })}
      />
    </div>
  );
}
