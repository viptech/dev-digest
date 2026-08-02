"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, SelectInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useAgents } from "@/lib/hooks/agents";
import { api } from "@/lib/api";
import { buildSkillBody } from "./helpers";

export function CreateSkillFromConventionsModal({
  accepted,
  onClose,
}: {
  accepted: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const { data: agents } = useAgents();
  const create = useCreateSkill();
  const [name, setName] = React.useState("repo-conventions");
  const [description, setDescription] = React.useState("House conventions extracted from this repo.");
  const [body, setBody] = React.useState(() => buildSkillBody(accepted));
  const [agentId, setAgentId] = React.useState(agents?.[0]?.id ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agentId && agents && agents.length > 0) setAgentId(agents[0]!.id);
  }, [agents, agentId]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const skill = await create.mutateAsync({ name, description, type: "convention", body });
      if (agentId) {
        await api.post(`/agents/${agentId}/skills`, { skill_id: skill.id });
      }
      onClose();
    } catch {
      setError(t("card.acceptFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      width={720}
      title={t("createSkillModal.title")}
      subtitle={t("createSkillModal.subtitle", { count: accepted.length })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("card.cancelEdit")}
          </Button>
          <Button kind="primary" onClick={submit} disabled={saving || !name.trim() || !body.trim() || !agentId}>
            {saving ? t("createSkillModal.saving") : t("createSkillModal.save")}
          </Button>
        </div>
      }
    >
      {error && <div style={{ color: "var(--crit)", marginBottom: 12 }}>{error}</div>}
      <FormField label={t("createSkillModal.nameLabel")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("createSkillModal.descriptionLabel")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("createSkillModal.agentLabel")} required>
        <SelectInput
          value={agentId}
          onChange={setAgentId}
          options={(agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
      </FormField>
      <FormField label={t("createSkillModal.bodyLabel")} required>
        <Textarea value={body} onChange={setBody} rows={14} mono />
      </FormField>
    </Modal>
  );
}
