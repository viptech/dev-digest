/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { FindingsSeverityBadges } from "@/components/findings-severity-badges";
import type { FindingsSummary, Verdict } from "@devdigest/shared";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  cost,
  findingsSummary,
  groupScoreWithCost,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  /** This run's spend, matched from the PR's run history by run_id; absent
   *  when there's no match (e.g. no run history loaded yet). */
  cost?: { costUsd: number | null; tokensIn: number | null; tokensOut: number | null };
  /**
   * When provided, renders the PR-list's per-severity badges (same
   * `FindingsSeverityBadges` as `PRRow`) INSTEAD of the plain "N findings ·
   * M blockers" text badge below — used by the PR-level "PR Brief" card so
   * its findings display always matches the list, never a separately
   * recomputed total. Omitted (the default, e.g. the per-run Findings-tab
   * accordion) keeps the original count/blockers badge unchanged.
   */
  findingsSummary?: FindingsSummary | null;
  /**
   * When true, `cost` renders inside the score column (gauge + divider +
   * cost line, one grouped right-side block) instead of its own row under
   * the summary text — used by the PR Brief card. Omitted (the default, the
   * per-run Findings-tab accordion) keeps cost in its own row.
   */
  groupScoreWithCost?: boolean;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          {findingsSummary !== undefined ? (
            <FindingsSeverityBadges summary={findingsSummary} />
          ) : (
            <Badge color="var(--text-secondary)">
              {t("verdict.findingsCount", { count: findingsCount })}
              {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
            </Badge>
          )}
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
        {cost && !groupScoreWithCost && (
          <div style={s.costRow}>
            <RunCostBadge
              costUsd={cost.costUsd}
              tokensIn={cost.tokensIn}
              tokensOut={cost.tokensOut}
              variant="detailed"
              tokenFormat="pair"
            />
          </div>
        )}
      </div>
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
          {cost && groupScoreWithCost && (
            <>
              <div style={s.scoreDivider} />
              <RunCostBadge
                costUsd={cost.costUsd}
                tokensIn={cost.tokensIn}
                tokensOut={cost.tokensOut}
                variant="detailed"
                tokenFormat="pair"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
