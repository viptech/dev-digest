"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { ContextDocPicker } from "../../../../../../../components/context-doc-picker";
import {
  useAgentContextDocs,
  useSetAgentContextDocs,
  useAgentSkills,
} from "../../../../../../../lib/hooks/agents";
import { useSkills, useSkillsContextDocs } from "../../../../../../../lib/hooks/skills";
import { aggregateContextDocCount } from "./helpers";
import { s } from "./styles";

/** Context tab — attach/detach/reorder this agent's `.md` documents
 *  (SPEC-01). Every check/uncheck/reorder sends the FULL ordered set,
 *  matching `ProjectContextRepository.setAgentDocs`'s replace-whole-set
 *  semantics, same convention as the Skills tab's `useSetAgentSkills`.
 *
 *  SPEC-02 (T4) adds a combined "own + enabled linked skills" attached-doc
 *  count next to the picker — the same agent-docs-then-enabled-linked-skills
 *  union/dedup the actual prompt build already computes at run time
 *  (`ProjectContextService.resolveAgentContext`), surfaced here before a run
 *  instead of only in a completed run's trace. */
export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("projectContext");
  const { data: docs } = useAgentContextDocs(agentId);
  const setDocs = useSetAgentContextDocs(agentId);

  const { data: links } = useAgentSkills(agentId);
  const { data: allSkills } = useSkills();

  // Linked skill ids in prompt order, filtered to only those whose `Skill`
  // itself is enabled — `AgentSkillLink` carries no `enabled` field of its
  // own (same join `SkillsTab.tsx` already does for its own render order).
  const enabledLinkedSkillIds = React.useMemo(() => {
    const orderedLinkedIds = (links ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((l) => l.skill_id);
    return orderedLinkedIds.filter((id) => allSkills?.find((sk) => sk.id === id)?.enabled === true);
  }, [links, allSkills]);

  const skillDocsById = useSkillsContextDocs(enabledLinkedSkillIds);

  const { own, fromSkills, total } = aggregateContextDocCount(
    docs ?? [],
    enabledLinkedSkillIds,
    skillDocsById,
  );

  return (
    <div style={s.wrap}>
      <div style={s.aggregateRow}>
        <Badge>{t("aggregateBadge", { count: total })}</Badge>
        {fromSkills > 0 && (
          <span style={s.aggregateBreakdown}>{t("aggregateBreakdown", { own, fromSkills })}</span>
        )}
      </div>
      <ContextDocPicker
        attachedDocs={docs ?? []}
        onSetDocs={(next) => setDocs.mutate(next)}
        isSaving={setDocs.isPending}
      />
    </div>
  );
}
