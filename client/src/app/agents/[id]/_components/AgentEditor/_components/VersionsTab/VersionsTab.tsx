"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import type { AgentVersion } from "@devdigest/shared";
import { useAgentVersions, useUpdateAgent, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { diffPromptLines } from "../../../../../../../lib/text-diff";
import { fieldChanges, type FieldChange } from "./helpers";
import { VersionDetailModal } from "./VersionDetailModal";
import { s } from "./styles";

/**
 * Versions tab — agent-side counterpart to `skills/[id]/_components/
 * SkillEditorView/_components/VersionsTab.tsx`. Lists `agent_versions` for
 * this agent, newest first (`useAgentVersions`, already-wired
 * `GET /agents/:id/versions`). Selecting exactly two rows renders a
 * line-level diff of their `system_prompt`s (the field closest to a skill's
 * `body`) via the same `diffPromptLines`, plus a compact "Also changed" list
 * for every other config field the two snapshots differ on (`fieldChanges`)
 * — an agent version snapshots the WHOLE reviewer config, not just one
 * field, so hiding those differences would make Restore look like a no-op
 * prompt swap when it can also flip provider/model/strategy/gate/repo-intel
 * or the linked-skill set.
 *
 * Restore is a plain per-row action (independent of the diff-selection
 * checkboxes), same as skills — but unlike skills' single `useUpdateSkill`
 * call, it must reapply the FULL snapshot: `useUpdateAgent` for the scalar
 * config fields, plus `useSetAgentSkills` for the linked-skill set, since
 * both are part of what was captured at that version.
 */
export function VersionsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const { data: versions, isLoading } = useAgentVersions(agentId);
  const update = useUpdateAgent();
  const setSkills = useSetAgentSkills(agentId);
  const [selected, setSelected] = React.useState<number[]>([]);
  const [viewing, setViewing] = React.useState<AgentVersion | null>(null);

  const toggle = (version: number) => {
    setSelected((prev) => {
      if (prev.includes(version)) return prev.filter((v) => v !== version);
      // Keep at most 2 — a third pick replaces the earlier of the two
      // already-selected versions (same FIFO idea as skills' VersionsTab).
      if (prev.length >= 2) return [prev[1]!, version];
      return [...prev, version];
    });
  };

  const restore = (v: AgentVersion) => {
    update.mutate({
      id: agentId,
      patch: {
        provider: v.config.provider,
        model: v.config.model,
        system_prompt: v.config.system_prompt,
        output_schema: v.config.output_schema,
        strategy: v.config.strategy,
        ci_fail_on: v.config.ci_fail_on,
        repo_intel: v.config.repo_intel,
      },
    });
    setSkills.mutate(v.config.skills);
  };

  if (isLoading || !versions) {
    return <div style={s.wrap}>{t("versions.loading")}</div>;
  }

  const restoring = update.isPending || setSkills.isPending;
  const selectedVersions = versions.filter((v) => selected.includes(v.version));
  const [older, newer] =
    selectedVersions.length === 2
      ? selectedVersions[0]!.version < selectedVersions[1]!.version
        ? [selectedVersions[0]!, selectedVersions[1]!]
        : [selectedVersions[1]!, selectedVersions[0]!]
      : [undefined, undefined];
  const diffLines = older && newer ? diffPromptLines(older.config.system_prompt, newer.config.system_prompt) : [];
  const otherChanges = older && newer ? fieldChanges(older.config, newer.config) : [];

  const fieldLabel = (key: FieldChange["key"]) =>
    key === "skills" ? t("versions.skillsField") : t(`config.${key}`);
  const fieldValue = (key: FieldChange["key"], value: FieldChange["from"]) => {
    if (key === "repoIntel") return value ? t("versions.boolOn") : t("versions.boolOff");
    if (key === "skills") return t("card.skillCount", { count: value as number });
    return String(value);
  };

  return (
    <div style={s.wrap}>
      <div style={s.list}>
        {versions.map((v) => (
          <div key={v.version} style={s.row}>
            <div style={s.rowLeft}>
              <Checkbox
                checked={selected.includes(v.version)}
                onChange={() => toggle(v.version)}
                label={t("versions.version", { version: v.version })}
              />
              <span style={s.createdAt}>{new Date(v.created_at).toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button kind="ghost" size="sm" onClick={() => setViewing(v)}>
                {t("versions.view")}
              </Button>
              <Button kind="secondary" size="sm" disabled={restoring} onClick={() => restore(v)}>
                {restoring ? t("versions.restoring") : t("versions.restore")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {viewing && (
        <VersionDetailModal
          version={viewing}
          onClose={() => setViewing(null)}
          onRestore={(v) => {
            restore(v);
            setViewing(null);
          }}
          restoring={restoring}
        />
      )}

      {selected.length !== 2 && versions.length > 1 && <p style={s.hint}>{t("versions.selectTwoHint")}</p>}

      {older && newer && (
        <div>
          <h3 style={s.diffHeading}>
            {t("versions.promptDiffHeading", { older: older.version, newer: newer.version })}
          </h3>
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

      {otherChanges.length > 0 && (
        <div>
          <h3 style={s.otherChangesHeading}>{t("versions.otherChanges")}</h3>
          <div style={s.otherChangesList}>
            {otherChanges.map((c) => (
              <div key={c.key}>
                {t("versions.fieldChange", {
                  label: fieldLabel(c.key),
                  from: fieldValue(c.key, c.from),
                  to: fieldValue(c.key, c.to),
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
