/* ColumnsView — SPEC-07 T11 (G5). One card per run of the current
   multi-agent group: CircularScore, agent name, RunCostBadge, a status badge
   (`outcomeOf`, promoted to `@/lib/run-outcome` so RunHistory and this view
   share one derivation, AC-26), this run's findings (title + `file:line` +
   severity icon via `SEV`), and a "View trace" action. Re-renders on
   `usePrRuns`'s existing 4s poll while any run in the group is `running`
   (AC-27) — the caller (`MultiAgentReviewTab`) already reuses that hook's
   data as-is; this component starts no poll of its own. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Icon, SEV, type Severity } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { outcomeOf } from "@/lib/run-outcome";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

interface ColumnsViewProps {
  /** The current group's runs (`MultiAgentReviewTab`'s `activeGroup.runs`). */
  runs: RunSummary[];
  /** Persisted reviews for this PR — matched by `run_id`, same pattern as
   *  `RunHistory`'s own `findingsByRunId` map, no extra fetch. */
  reviews: ReviewRecord[];
  onOpenTrace: (runId: string) => void;
}

export function ColumnsView({ runs, reviews, onOpenTrace }: ColumnsViewProps) {
  const t = useTranslations("prReview");

  const reviewByRunId = React.useMemo(
    () => new Map(reviews.filter((r) => r.run_id).map((r) => [r.run_id as string, r])),
    [reviews],
  );

  return (
    <div style={s.grid}>
      {runs.map((run) => {
        const o = outcomeOf(run);
        const settled = run.status === "done";
        const review = reviewByRunId.get(run.run_id);
        const findings = review?.findings ?? [];

        return (
          <div key={run.run_id} style={s.column}>
            <div style={s.columnHeader}>
              {settled && run.score != null && <CircularScore score={run.score} size={32} stroke={3} />}
              <div style={s.columnHeaderMeta}>
                <span style={s.agentName}>{run.agent_name ?? t("multiAgentReview.unknownAgent")}</span>
                <span className="mono" style={s.model}>
                  {run.provider}/{run.model}
                </span>
              </div>
            </div>

            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${o.key}`)}
            </Badge>

            {run.status === "failed" && run.error && (
              <div style={s.errorText} title={run.error}>
                {run.error}
              </div>
            )}

            {settled && (
              <RunCostBadge
                costUsd={run.cost_usd}
                tokensIn={run.tokens_in}
                tokensOut={run.tokens_out}
                variant="detailed"
                tokenFormat="total"
              />
            )}

            {settled && (
              <div style={s.findingsList}>
                {findings.length === 0 ? (
                  <span style={s.noFindings}>{t("multiAgentReview.noFindings")}</span>
                ) : (
                  findings.map((f) => {
                    const sev = SEV[f.severity as Severity];
                    const SevIcon = Icon[sev.icon];
                    return (
                      <div key={f.id} style={s.findingRow}>
                        <div style={s.findingTitleRow}>
                          <SevIcon size={12} style={{ color: sev.c, flexShrink: 0, marginTop: 1 }} />
                          <span style={s.findingTitle}>{f.title}</span>
                        </div>
                        <span className="mono" style={s.findingLoc} title={`${f.file}:${f.start_line}`}>
                          {f.file}:{f.start_line}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <Button kind="ghost" size="sm" icon="FileText" onClick={() => onOpenTrace(run.run_id)}>
              {t("multiAgentReview.viewTrace")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
