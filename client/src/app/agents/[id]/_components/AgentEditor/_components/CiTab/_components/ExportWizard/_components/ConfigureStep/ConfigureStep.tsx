"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Toggle, Badge } from "@devdigest/ui";
import { useSecretsStatus } from "@/lib/hooks/core";
import { RadioRow } from "../RadioRow";
import type { PostAs, TriggerState } from "../../helpers";
import { s } from "./styles";

/**
 * Configure step (G5) — trigger checkboxes (AC-13/AC-14), "Post results as"
 * (AC-15), the permanently-disabled "Block merge on findings" (AC-16 — no
 * `disabled` prop on `Toggle`, `client/src/vendor/ui/primitives/Toggle.tsx`,
 * so it's locked out with `pointerEvents: "none"` + a fixed `on={false}`
 * rather than real state), and "Secrets expected" (AC-17 — exactly
 * `OPENROUTER_API_KEY` + `GITHUB_TOKEN`, no ingest-token row per G9's
 * PULL-model).
 */
export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAsChange,
}: {
  triggers: TriggerState;
  onToggleTrigger: (key: keyof TriggerState) => void;
  postAs: PostAs;
  onPostAsChange: (v: PostAs) => void;
}) {
  const t = useTranslations("ci");
  const { data: secretsStatus } = useSecretsStatus();
  const openrouterConfigured = secretsStatus?.openrouter ?? false;

  return (
    <div>
      <div style={s.section}>
        <div style={s.sectionTitle}>{t("exportWizard.triggerLabel")}</div>
        <div style={s.triggerList}>
          <Checkbox
            checked={triggers.opened}
            onChange={() => onToggleTrigger("opened")}
            label={t("exportWizard.triggers.opened")}
          />
          <Checkbox
            checked={triggers.synchronize}
            onChange={() => onToggleTrigger("synchronize")}
            label={t("exportWizard.triggers.synchronize")}
          />
          <Checkbox
            checked={triggers.reopened}
            onChange={() => onToggleTrigger("reopened")}
            label={t("exportWizard.triggers.reopened")}
          />
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("exportWizard.postResultsLabel")}</div>
        <RadioRow
          checked={postAs === "github_review"}
          onSelect={() => onPostAsChange("github_review")}
          label={t("exportWizard.postAs.githubReview")}
          badge={<Badge color="var(--ok)" bg="var(--ok-bg)">{t("exportWizard.recommended")}</Badge>}
        />
        <RadioRow
          checked={postAs === "pr_comment"}
          onSelect={() => onPostAsChange("pr_comment")}
          label={t("exportWizard.postAs.prComment")}
        />
        <RadioRow
          checked={postAs === "none"}
          onSelect={() => onPostAsChange("none")}
          label={t("exportWizard.postAs.none")}
        />
      </div>

      <div style={s.section}>
        <div style={s.blockMergeRow}>
          <div style={s.blockMergeText}>
            <span style={s.blockMergeTitle}>{t("exportWizard.blockMergeTitle")}</span>
            <span style={s.blockMergeDesc}>{t("exportWizard.blockMergeDesc")}</span>
          </div>
          <span style={s.disabledToggle}>
            <Toggle on={false} onChange={() => {}} size={16} />
          </span>
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("exportWizard.secretsExpected")}</div>
        <div style={s.secretsList}>
          <div style={s.secretRow}>
            <div>
              <div style={s.secretName}>{t("exportWizard.secrets.openrouterName")}</div>
              <div style={s.secretHint}>{t("exportWizard.secrets.openrouterHint")}</div>
            </div>
            <span style={s.secretBadgeSlot}>
              <Badge color={openrouterConfigured ? "var(--ok)" : "var(--warn)"}>
                {openrouterConfigured ? t("exportWizard.secrets.configured") : t("exportWizard.secrets.notSet")}
              </Badge>
            </span>
          </div>
          <div style={s.secretRow}>
            <div>
              <div style={s.secretName}>{t("exportWizard.secrets.githubName")}</div>
              <div style={s.secretHint}>{t("exportWizard.secrets.githubHint")}</div>
            </div>
            <span style={s.secretBadgeSlot}>
              <Badge color="var(--ok)">{t("exportWizard.secrets.ready")}</Badge>
            </span>
          </div>
        </div>
        <p style={s.secretsNote}>{t("exportWizard.secretNote", { key: "OPENROUTER_API_KEY" })}</p>
      </div>
    </div>
  );
}
