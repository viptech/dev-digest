"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { AgentVersion } from "@devdigest/shared";
import { s } from "./styles";

/**
 * Full text of one agent version, opened via its row's "View" action in
 * `VersionsTab`. The system prompt is the primary content (closest analog
 * to a skill version's `body`); the rest of the snapshotted config renders
 * below it as a compact read-only list, since an agent version captures the
 * whole reviewer config, not just the prompt (see `VersionsTab.tsx`'s
 * header comment / `helpers.ts`'s `fieldChanges`).
 */
export function VersionDetailModal({
  version,
  onClose,
  onRestore,
  restoring,
}: {
  version: AgentVersion;
  onClose: () => void;
  onRestore: (v: AgentVersion) => void;
  restoring: boolean;
}) {
  const t = useTranslations("agents");
  const c = version.config;

  const rows: { label: string; value: string }[] = [
    { label: t("config.provider"), value: c.provider },
    { label: t("config.model"), value: c.model },
    { label: t("config.strategy"), value: c.strategy },
    { label: t("config.ciFailOn"), value: c.ci_fail_on },
    { label: t("config.repoIntel"), value: c.repo_intel ? t("versions.boolOn") : t("versions.boolOff") },
    { label: t("versions.skillsField"), value: t("card.skillCount", { count: c.skills.length }) },
  ];

  return (
    <Modal
      width={680}
      title={t("versions.version", { version: version.version })}
      subtitle={new Date(version.created_at).toLocaleString()}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <Button kind="ghost" onClick={onClose}>
            {t("versions.close")}
          </Button>
          <Button kind="primary" disabled={restoring} onClick={() => onRestore(version)}>
            {restoring ? t("versions.restoring") : t("versions.restore")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        <div>
          <h3 style={s.modalSectionHeading}>{t("versions.systemPromptLabel")}</h3>
          <div style={s.promptBox}>{c.system_prompt}</div>
        </div>
        <div>
          <h3 style={s.modalSectionHeading}>{t("versions.configLabel")}</h3>
          <div style={s.configList}>
            {rows.map((r) => (
              <div key={r.label} style={s.configRow}>
                <span style={s.configRowLabel}>{r.label}</span>
                <span style={s.configRowValue}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
