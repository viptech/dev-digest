"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportPreview, useImportSkill } from "../../../../lib/hooks/skills";
import { readFileAsText } from "./helpers";
import { s } from "./styles";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

/** Create/import a skill. No longer handles "edit" (SPEC-06) — editing an
 *  existing skill now lives at `/skills/:id` (`SkillEditorView`'s Config
 *  tab). There's no `id` to route to until create/import persists one, so
 *  the drawer stays the entry point for those two modes only. */
export function SkillDrawer({
  mode,
  onClose,
}: {
  mode: "create" | "import";
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const importPreview = useImportPreview();
  const importSave = useImportSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [previewed, setPreviewed] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);

  const onFile = async (file: File) => {
    setImportError(null);
    try {
      const content = await readFileAsText(file);
      const preview = await importPreview.mutateAsync({ filename: file.name, content });
      setName(preview.name);
      setDescription(preview.description);
      setBody(preview.body);
      setPreviewed(true);
    } catch {
      setImportError(t("drawer.importFailed"));
    }
  };

  // Successful create/import navigates into the new Skill Editor route
  // instead of just closing (AC-4) — same pattern as
  // `CreateAgentModal.tsx:32`'s `router.push` after `create.mutateAsync`.
  const submit = async () => {
    setImportError(null);
    try {
      const skill =
        mode === "create"
          ? await create.mutateAsync({ name, description, type, body })
          : await importSave.mutateAsync({ name, description, type, body });
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch {
      setImportError(t("drawer.saveFailed"));
    }
  };

  const saving = create.isPending || importSave.isPending;
  const canSave =
    mode === "import" ? previewed && name.trim().length > 0 : name.trim().length > 0 && body.trim().length > 0;

  return (
    <Drawer
      width={720}
      title={mode === "import" ? t("drawer.title") : name || t("page.selectPrompt.title")}
      subtitle={mode === "import" ? t("drawer.subtitle") : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {importError && !(mode === "import" && !previewed) && (
            <div style={s.untrustedNotice}>{importError}</div>
          )}
          <div style={s.footer}>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <Button kind="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button kind="primary" onClick={submit} disabled={!canSave || saving}>
                {saving ? t("file.importing") : t("preview.save")}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <div style={s.body}>
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
        {mode === "import" && !previewed && importError && (
          <div style={s.untrustedNotice}>{importError}</div>
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
          </>
        )}
      </div>
    </Drawer>
  );
}
