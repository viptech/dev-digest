"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ContextDocPicker } from "@/components/context-doc-picker";
import { useSkillContextDocs, useSetSkillContextDocs } from "@/lib/hooks/skills";
import { serializesAs } from "./helpers";
import { s } from "./styles";

/**
 * Context tab (SPEC-06 G4, Development Plan `skill-editor.md` Step 7.3) —
 * the same `ContextDocPicker` + "SERIALIZES AS" preview that lived in
 * `SkillDrawer`'s "edit" mode (removed in Step 6), moved here verbatim and
 * wired to the already-existing `useSkillContextDocs`/`useSetSkillContextDocs`
 * (AC-10). No server-side changes, no behavior change to attach/detach/
 * reorder/dedup/run-time resolution (AC-11) — this is a pure UI relocation.
 */
export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("projectContext");
  const { data: docs } = useSkillContextDocs(skillId);
  const setDocs = useSetSkillContextDocs(skillId);

  return (
    <div style={s.wrap}>
      <ContextDocPicker
        attachedDocs={docs ?? []}
        onSetDocs={(next) => setDocs.mutate(next)}
        isSaving={setDocs.isPending}
      />
      <div style={s.serializesAs}>
        <div style={s.serializesAsLabel}>{t("serializesAsTitle")}</div>
        <pre style={s.serializesAsCode}>{serializesAs(docs ?? [])}</pre>
        <p style={s.hint}>{t("serializesAsHint")}</p>
      </div>
    </div>
  );
}
