"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  defaultBranch,
  onSetStatus,
  onSaveRule,
  busy,
  error,
}: {
  candidate: ConventionCandidate;
  repoFullName?: string;
  defaultBranch?: string;
  onSetStatus: (status: "accepted" | "rejected") => void;
  onSaveRule: (rule: string) => void;
  busy?: boolean;
  error?: string;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(candidate.rule);

  const githubUrl =
    repoFullName && defaultBranch && candidate.evidence_path && candidate.evidence_line
      ? `https://github.com/${repoFullName}/blob/${defaultBranch}/${candidate.evidence_path}#L${candidate.evidence_line}`
      : null;

  const saveRule = () => {
    onSaveRule(draftRule);
    setEditing(false);
  };

  return (
    <div style={s.card}>
      {editing ? (
        <>
          <Textarea value={draftRule} onChange={setDraftRule} rows={3} />
          <div style={s.footer}>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                setDraftRule(candidate.rule);
                setEditing(false);
              }}
            >
              {t("card.cancelEdit")}
            </Button>
            <Button kind="primary" size="sm" onClick={saveRule}>
              {t("card.saveRule")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={s.rule}>{candidate.rule}</div>
          {candidate.evidence_path && (
            <div style={s.evidence}>
              {githubUrl ? (
                <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                  {candidate.evidence_path}
                  {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
                </a>
              ) : (
                <>
                  {candidate.evidence_path}
                  {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
                </>
              )}
              {candidate.evidence_snippet ? `\n${candidate.evidence_snippet}` : ""}
            </div>
          )}
          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            {candidate.category && <Badge color="var(--text-muted)">{candidate.category}</Badge>}
            {candidate.confidence != null && (
              <Badge color="var(--text-secondary)">
                {t("card.confidence")}: {Math.round(candidate.confidence * 100)}%
              </Badge>
            )}
            {candidate.status === "accepted" && <Badge color="var(--ok)">{t("card.accepted")}</Badge>}
            {candidate.status === "rejected" && <Badge color="var(--crit)">{t("card.rejected")}</Badge>}
            <Button kind="ghost" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              {t("card.editRule")}
            </Button>
            {candidate.status !== "accepted" && (
              <Button kind="secondary" size="sm" onClick={() => onSetStatus("accepted")} disabled={busy}>
                {busy ? t("card.accepting") : t("card.acceptAsSkill")}
              </Button>
            )}
            {candidate.status !== "rejected" && (
              <Button kind="ghost" size="sm" onClick={() => onSetStatus("rejected")} disabled={busy}>
                {busy ? t("card.rejecting") : t("card.reject")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
