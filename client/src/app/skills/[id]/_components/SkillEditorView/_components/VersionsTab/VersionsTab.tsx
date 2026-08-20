"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import type { SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { diffPromptLines } from "@/lib/text-diff";
import { s } from "./styles";

/**
 * Versions tab (SPEC-06 G7, Development Plan `skill-editor.md` Step 9) —
 * lists `skill_versions` for this skill, newest first (AC-28, via the
 * already-verified `GET /skills/:id/versions`). Selecting exactly two rows
 * renders a line-level diff between their `body`s using `diffPromptLines`
 * (AC-29, promoted to `@/lib/text-diff`). Restore is a plain per-row action
 * (independent of the diff-selection checkboxes) that calls the existing
 * `useUpdateSkill` with `{ body: V.body }` — no new mutation route (AC-30).
 * A no-op Restore (selected body already equals the current one) relies
 * entirely on the server-side `bodyChanged` guard
 * (`server/src/modules/skills/repository.ts:85`) to skip a new snapshot
 * (AC-31) — no client-side duplicate check here.
 */
export function VersionsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading } = useSkillVersions(skillId);
  const update = useUpdateSkill();
  const [selected, setSelected] = React.useState<number[]>([]);

  const toggle = (version: number) => {
    setSelected((prev) => {
      if (prev.includes(version)) return prev.filter((v) => v !== version);
      // Keep at most 2 — a third pick replaces the earlier of the two
      // already-selected versions (same FIFO idea as the eval-owner-tab's
      // set-run comparison selection).
      if (prev.length >= 2) return [prev[1]!, version];
      return [...prev, version];
    });
  };

  const restore = (version: SkillVersion) => {
    update.mutate({ id: skillId, patch: { body: version.body } });
  };

  if (isLoading || !versions) {
    return <div style={s.wrap}>{t("versions.loading")}</div>;
  }

  const selectedVersions = versions.filter((v) => selected.includes(v.version));
  const [older, newer] =
    selectedVersions.length === 2
      ? selectedVersions[0]!.version < selectedVersions[1]!.version
        ? [selectedVersions[0]!, selectedVersions[1]!]
        : [selectedVersions[1]!, selectedVersions[0]!]
      : [undefined, undefined];
  const diffLines = older && newer ? diffPromptLines(older.body, newer.body) : [];

  return (
    <div style={s.wrap}>
      <div style={s.list}>
        {versions.map((v) => (
          <div key={v.version} style={s.row}>
            <div style={s.rowLeft}>
              <Checkbox
                checked={selected.includes(v.version)}
                onChange={() => toggle(v.version)}
                label={t("preview.version", { version: v.version })}
              />
              <span style={s.createdAt}>{new Date(v.created_at).toLocaleString()}</span>
            </div>
            <Button kind="secondary" size="sm" disabled={update.isPending} onClick={() => restore(v)}>
              {update.isPending ? t("versions.restoring") : t("versions.restore")}
            </Button>
          </div>
        ))}
      </div>

      {selected.length !== 2 && versions.length > 1 && <p style={s.hint}>{t("versions.selectTwoHint")}</p>}

      {older && newer && (
        <div>
          <h3 style={s.diffHeading}>{t("versions.diffHeading", { older: older.version, newer: newer.version })}</h3>
          <div style={s.diffBox}>
            {diffLines.map((line, i) => (
              <div key={i} style={s.diffLine(line.status)}>
                {line.status === "removed" ? "- " : line.status === "added" ? "+ " : "  "}
                {line.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
