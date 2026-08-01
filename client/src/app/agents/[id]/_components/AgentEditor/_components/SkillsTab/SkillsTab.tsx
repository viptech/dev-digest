"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Badge, TextInput, Icon } from "@devdigest/ui";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { filterSkills, reorder } from "./helpers";
import { s } from "./styles";

/** Skills tab — link/unlink skills for this agent and reorder the linked
 *  ones (order = position in the assembled prompt). Every check/uncheck/
 *  reorder sends the FULL ordered skill_ids array, matching
 *  AgentsRepository.setSkills's replace-whole-set semantics. */
export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agentId);
  const setSkills = useSetAgentSkills(agentId);
  const [query, setQuery] = React.useState("");
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);

  const linkedIds = React.useMemo(
    () => (links ?? []).slice().sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );

  const toggle = (skillId: string, on: boolean) => {
    const next = on ? [...linkedIds, skillId] : linkedIds.filter((id) => id !== skillId);
    setSkills.mutate(next);
  };

  const onDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    setSkills.mutate(reorder(linkedIds, dragIdx, targetIdx));
    setDragIdx(null);
  };

  // Render order: linked skills first (in prompt order), then the rest, filtered by query.
  const linkedSet = new Set(linkedIds);
  const ordered = [
    ...linkedIds
      .map((id) => allSkills?.find((sk) => sk.id === id))
      .filter((sk): sk is NonNullable<typeof sk> => !!sk),
    ...(allSkills ?? []).filter((sk) => !linkedSet.has(sk.id)),
  ];
  const visible = filterSkills(ordered, query);

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("skills.title")}</h2>
        <span style={s.count}>
          {t("skills.enabledCount", { linked: linkedIds.length, total: allSkills?.length ?? 0 })}
        </span>
        <div style={{ marginLeft: "auto", width: 220 }}>
          <TextInput value={query} onChange={setQuery} placeholder={t("skills.filterPlaceholder")} />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      {visible.map((sk) => {
        const idx = linkedIds.indexOf(sk.id);
        const isLinked = idx >= 0;
        return (
          <div
            key={sk.id}
            style={s.row}
            draggable={isLinked}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => isLinked && e.preventDefault()}
            onDrop={() => isLinked && onDrop(idx)}
          >
            {isLinked && <Icon.Menu size={12} style={{ color: "var(--text-muted)", cursor: "grab" }} />}
            <Checkbox checked={isLinked} onChange={(on) => toggle(sk.id, on)} />
            <span style={s.name}>{sk.name}</span>
            <Badge color="var(--text-muted)">{sk.type}</Badge>
          </div>
        );
      })}
    </div>
  );
}
