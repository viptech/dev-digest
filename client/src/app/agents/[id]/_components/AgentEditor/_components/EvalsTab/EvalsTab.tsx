"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge } from "@devdigest/ui";
import { useEvalCases, useRunEvalCase, useDeleteEvalCase } from "../../../../../../../lib/hooks/evals";
import { ApiError } from "../../../../../../../lib/api";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { s } from "./styles";

/** Evals tab — list eval cases for this agent, open the case modal to
 *  create/edit one, run a case, or delete it. Each row shows the last run's
 *  pass/fail result (or "never run") once a run completes. */
export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading } = useEvalCases(agentId);
  const run = useRunEvalCase(agentId);
  const del = useDeleteEvalCase(agentId);
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  const editingCase = editing && editing !== "new" ? cases?.find((c) => c.id === editing) : undefined;

  const clearRowError = (id: string) =>
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const onRun = async (id: string) => {
    clearRowError(id);
    setRunningId(id);
    try {
      await run.mutateAsync(id);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : t("evalsTab.runFailed");
      setRowErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setRunningId(null);
    }
  };

  const onDelete = async (id: string) => {
    clearRowError(id);
    setDeletingId(id);
    try {
      await del.mutateAsync(id);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : t("evalsTab.deleteFailed");
      setRowErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setDeletingId(null);
    }
  };

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
        <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          <div style={{ ...s.row, marginBottom: 0 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => setEditing(c.id)}>
              {c.name}
            </span>
            {c.last_run ? (
              <Badge color={s.resultBadge(c.last_run.pass).color}>
                {(c.last_run.pass ? t("evalsTab.passed") : t("evalsTab.failed")) +
                  t("evalsTab.recallSuffix", { recall: Math.round(c.last_run.recall * 100) })}
              </Badge>
            ) : (
              <Badge>{t("evalsTab.neverRun")}</Badge>
            )}
            <Button
              kind="ghost"
              size="sm"
              icon="Play"
              onClick={() => onRun(c.id)}
              disabled={runningId === c.id}
            >
              {runningId === c.id ? t("evalsTab.running") : t("evalsTab.run")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Trash"
              onClick={() => onDelete(c.id)}
              disabled={deletingId === c.id}
            />
          </div>
          {rowErrors[c.id] && <div style={s.rowError}>{rowErrors[c.id]}</div>}
        </div>
      ))}
    </div>
  );
}
