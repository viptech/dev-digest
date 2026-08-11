"use client";

import React from "react";
import { ContextDocPicker } from "../../../../../../../components/context-doc-picker";
import { useAgentContextDocs, useSetAgentContextDocs } from "../../../../../../../lib/hooks/agents";
import { s } from "./styles";

/** Context tab — attach/detach/reorder this agent's `.md` documents
 *  (SPEC-01). Every check/uncheck/reorder sends the FULL ordered set,
 *  matching `ProjectContextRepository.setAgentDocs`'s replace-whole-set
 *  semantics, same convention as the Skills tab's `useSetAgentSkills`. */
export function ContextTab({ agentId }: { agentId: string }) {
  const { data: docs } = useAgentContextDocs(agentId);
  const setDocs = useSetAgentContextDocs(agentId);

  return (
    <div style={s.wrap}>
      <ContextDocPicker
        attachedDocs={docs ?? []}
        onSetDocs={(next) => setDocs.mutate(next)}
        isSaving={setDocs.isPending}
      />
    </div>
  );
}
