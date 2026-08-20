"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { SkillVersion } from "@devdigest/shared";
import { s } from "./styles";

/**
 * Full text of one skill version, opened via its row's "View" action in
 * `VersionsTab`. Agent-side counterpart: `agents/[id]/_components/
 * AgentEditor/_components/VersionsTab/VersionDetailModal.tsx` — that one
 * also lists non-body config fields because an agent version snapshots the
 * whole reviewer config; a skill version only ever tracks `body`
 * (`skill_versions` has no other column), so this is just the body text.
 */
export function VersionDetailModal({
  version,
  onClose,
  onRestore,
  restoring,
}: {
  version: SkillVersion;
  onClose: () => void;
  onRestore: (v: SkillVersion) => void;
  restoring: boolean;
}) {
  const t = useTranslations("skills");

  return (
    <Modal
      width={680}
      title={t("preview.version", { version: version.version })}
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
        <h3 style={s.modalSectionHeading}>{t("preview.bodyLabel")}</h3>
        <div style={s.promptBox}>{version.body}</div>
      </div>
    </Modal>
  );
}
