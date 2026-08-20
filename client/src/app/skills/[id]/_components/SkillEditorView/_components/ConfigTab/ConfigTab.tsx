"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Badge, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { approxTokens } from "@/lib/hooks/project-context";
import { TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

/**
 * Config tab (SPEC-06 G2, Development Plan `skill-editor.md` Step 7.1) —
 * the fields `SkillDrawer`'s old "edit" mode rendered (name/description/
 * type/body/Enabled toggle/version badge), minus the Context section (its
 * own tab now, `ContextTab`), plus a token-count label next to the body
 * editor (`approxTokens(chars) = Math.ceil(chars/4)`, reused from
 * `lib/hooks/project-context.ts`, not reimplemented — AC-5).
 *
 * Saves through the existing `PUT /skills/:id` (`useUpdateSkill`) — no new
 * server mutation (AC-7). The version bump + `skill_versions` snapshot on a
 * changed `body` already happens server-side (`SkillsRepository.update()`).
 */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  // Reset local form when switching skills — same pattern as the agent
  // editor's ConfigTab.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unchanged condition, carried over from the pre-Step-6 `SkillDrawer.tsx`
  // ("edit" mode) — the same one `SkillCard.tsx`'s `needsVetting` still uses
  // today (AC-6).
  const showUntrustedNotice = skill.source !== "manual" && !skill.enabled;

  const save = () =>
    update.mutate({ id: skill.id, patch: { name, description, type, body, enabled } });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>
      {showUntrustedNotice && <div style={s.untrustedNotice}>{t("preview.untrustedNotice")}</div>}
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")} required>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
      </FormField>
      <FormField label={t("config.description")} required>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_OPTIONS]} />
      </FormField>
      <FormField
        label={t("preview.bodyLabel")}
        hint={t("preview.bodyHint")}
        required
        right={<span style={s.tokenCount}>{t("config.tokenCount", { tokens: approxTokens(body.length) })}</span>}
      >
        <Textarea value={body} onChange={setBody} rows={14} mono />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("config.saving") : t("preview.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
