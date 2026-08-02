"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon } from "@devdigest/ui";
import { useEvalCases, useRunEvalCase, useDeleteEvalCase } from "../../../../../../../lib/hooks/evals";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { s } from "./styles";

/** Evals tab — list eval cases for this agent, open the case modal to
 *  create/edit one, run a case, or delete it. */
export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading } = useEvalCases(agentId);
  const run = useRunEvalCase(agentId);
  const del = useDeleteEvalCase(agentId);
  const [editing, setEditing] = React.useState<string | "new" | null>(null);

  const editingCase = editing && editing !== "new" ? cases?.find((c) => c.id === editing) : undefined;

  return (
    <div style={s.wrap}>
      {(editing === "new" || editingCase) && (
        <EvalCaseModal agentId={agentId} existing={editingCase} onClose={() => setEditing(null)} />
      )}
      <div style={s.headerRow}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.casesHeading")}</h2>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
          {t("evalsTab.newCase")}
        </Button>
      </div>
      {isLoading && <p>{t("evalsTab.loadingCases")}</p>}
      {!isLoading && (cases?.length ?? 0) === 0 && <p>{t("evalsTab.emptyCases")}</p>}
      {(cases ?? []).map((c) => (
        <div key={c.id} style={s.row}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => setEditing(c.id)}>
            {c.name}
          </span>
          <Button
            kind="ghost"
            size="sm"
            icon="Play"
            onClick={() => run.mutate(c.id)}
            disabled={run.isPending}
          >
            {run.isPending ? t("evalsTab.running") : t("evalsTab.run")}
          </Button>
          <Button kind="ghost" size="sm" icon="Trash" onClick={() => del.mutate(c.id)} disabled={del.isPending} />
        </div>
      ))}
    </div>
  );
}
