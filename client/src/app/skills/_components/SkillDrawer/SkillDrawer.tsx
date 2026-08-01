"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, TextInput, SelectInput, Textarea, Badge } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import {
  useSkill,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useImportPreview,
  useImportSkill,
} from "../../../../lib/hooks/skills";
import { readFileAsText } from "./helpers";
import { s } from "./styles";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

export function SkillDrawer({
  mode,
  skillId,
  onClose,
}: {
  mode: "create" | "edit" | "import";
  skillId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const { data: existing } = useSkill(mode === "edit" ? skillId : undefined);
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const importPreview = useImportPreview();
  const importSave = useImportSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [previewed, setPreviewed] = React.useState(false);

  React.useEffect(() => {
    if (mode === "edit" && existing) {
      setName(existing.name);
      setDescription(existing.description);
      setType(existing.type);
      setBody(existing.body);
    }
  }, [mode, existing]);

  const onFile = async (file: File) => {
    const content = await readFileAsText(file);
    const preview = await importPreview.mutateAsync({ filename: file.name, content });
    setName(preview.name);
    setDescription(preview.description);
    setBody(preview.body);
    setPreviewed(true);
  };

  const submit = async () => {
    if (mode === "create") {
      await create.mutateAsync({ name, description, type, body });
    } else if (mode === "edit" && skillId) {
      await update.mutateAsync({ id: skillId, patch: { name, description, type, body } });
    } else if (mode === "import") {
      await importSave.mutateAsync({ name, description, type, body });
    }
    onClose();
  };

  const isUntrusted = mode === "edit" && existing && existing.source !== "manual";
  const saving = create.isPending || update.isPending || importSave.isPending;
  const canSave =
    mode === "import" ? previewed && name.trim().length > 0 : name.trim().length > 0 && body.trim().length > 0;

  return (
    <Drawer
      width={720}
      title={mode === "import" ? t("drawer.title") : name || t("page.selectPrompt.title")}
      subtitle={mode === "import" ? t("drawer.subtitle") : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {mode === "edit" && skillId && (
            <Button
              kind="ghost"
              onClick={() => del.mutateAsync(skillId).then(onClose)}
              disabled={del.isPending}
            >
              {t("preview.delete")}
            </Button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submit} disabled={!canSave || saving}>
              {saving ? t("file.importing") : t("preview.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        {isUntrusted && !existing!.enabled && (
          <div style={s.untrustedNotice}>{t("preview.untrustedNotice")}</div>
        )}
        {mode === "import" && !previewed && (
          <label style={s.dropzone}>
            <input
              type="file"
              accept=".md,.markdown"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            {t("file.bodyPlaceholder")}
          </label>
        )}
        {(mode !== "import" || previewed) && (
          <>
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")} required>
              <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
            </FormField>
            <FormField label="Description" required>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label="Type">
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={TYPE_OPTIONS} />
            </FormField>
            <FormField label={t("file.bodyLabel")} hint={t("preview.bodyHint")} required>
              <Textarea value={body} onChange={setBody} rows={14} mono />
            </FormField>
            {mode === "edit" && existing && <Badge>{t("preview.version", { version: existing.version })}</Badge>}
          </>
        )}
      </div>
    </Drawer>
  );
}
