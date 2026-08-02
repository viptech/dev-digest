"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  onAccept,
  accepting,
  error,
}: {
  candidate: ConventionCandidate;
  onAccept: () => void;
  accepting?: boolean;
  error?: string;
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.card}>
      <div style={s.rule}>{candidate.rule}</div>
      {candidate.evidence_path && (
        <div style={s.evidence}>
          {candidate.evidence_path}
          {candidate.evidence_snippet ? `\n${candidate.evidence_snippet}` : ""}
        </div>
      )}
      {error && <div style={s.error}>{error}</div>}
      <div style={s.footer}>
        {candidate.confidence != null && (
          <Badge color="var(--text-secondary)">
            {t("card.confidence")}: {Math.round(candidate.confidence * 100)}%
          </Badge>
        )}
        {candidate.accepted ? (
          <Badge color="var(--ok)">{t("card.accepted")}</Badge>
        ) : (
          <Button kind="secondary" size="sm" onClick={onAccept} disabled={accepting}>
            {accepting ? t("card.accepting") : t("card.acceptAsSkill")}
          </Button>
        )}
      </div>
    </div>
  );
}
