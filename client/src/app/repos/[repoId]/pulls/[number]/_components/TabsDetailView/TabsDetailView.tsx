/* TabsDetailView — SPEC-07 T12 (G5). One tab per agent in the current
   multi-agent group (a `CircularScore` badge in the tab itself), showing
   `review.score` + `review.summary` for the active tab, then the group's
   `FindingCard` list filtered to that agent's findings — reusing
   `FindingCard` as-is (Accept/Dismiss/Turn into eval case; AC-29's "no
   Learn/Reply button" is satisfied for free, per the plan's Constraints
   note — do not add a fourth button). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore } from "@devdigest/ui";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { useFindingAction } from "@/lib/hooks/reviews";
import { outcomeOf } from "@/lib/run-outcome";
import type { EvalCaseDraft } from "@/lib/hooks/evals";
import { FindingCard } from "../FindingCard";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

interface TabsDetailViewProps {
  /** The current group's runs (`MultiAgentReviewTab`'s `activeGroup.runs`). */
  runs: RunSummary[];
  /** Persisted reviews for this PR — matched by `run_id`. */
  reviews: ReviewRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (runId: string) => void;
}

export function TabsDetailView({
  runs,
  reviews,
  prId,
  repoFullName,
  headSha,
  onOpenTrace,
}: TabsDetailViewProps) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [activeRunId, setActiveRunId] = React.useState<string | null>(runs[0]?.run_id ?? null);
  // SPEC-05 T13 — mirrors FindingsPanel's "Turn into eval case" wiring: only
  // one card's draft can be open at a time, this view is the nearest common
  // ancestor of every FindingCard it renders.
  const [evalDraft, setEvalDraft] = React.useState<{
    draft: EvalCaseDraft;
    seededFrom: "accepted" | "dismissed";
  } | null>(null);

  // Keep the active tab valid across a poll-driven `runs` refresh (e.g. the
  // previously active run got dropped because a newer group superseded it).
  React.useEffect(() => {
    if (!runs.some((r) => r.run_id === activeRunId)) setActiveRunId(runs[0]?.run_id ?? null);
  }, [runs, activeRunId]);

  const reviewByRunId = React.useMemo(
    () => new Map(reviews.filter((r) => r.run_id).map((r) => [r.run_id as string, r])),
    [reviews],
  );

  const activeRun = runs.find((r) => r.run_id === activeRunId) ?? null;
  if (!activeRun) return null;
  const activeReview = reviewByRunId.get(activeRun.run_id) ?? null;
  const o = outcomeOf(activeRun);
  const settled = activeRun.status === "done";

  return (
    <div style={s.root}>
      {evalDraft && (
        <EvalCaseModal
          agentId={evalDraft.draft.owner_id}
          draft={evalDraft.draft}
          seededFrom={evalDraft.seededFrom}
          onClose={() => setEvalDraft(null)}
        />
      )}

      <div style={s.tabBar}>
        {runs.map((run) => {
          const active = run.run_id === activeRunId;
          const runSettled = run.status === "done";
          return (
            <button
              key={run.run_id}
              type="button"
              onClick={() => setActiveRunId(run.run_id)}
              style={s.tab(active)}
            >
              {runSettled && run.score != null && <CircularScore score={run.score} size={22} stroke={2.5} />}
              <span>{run.agent_name ?? t("multiAgentReview.unknownAgent")}</span>
            </button>
          );
        })}
      </div>

      <div style={s.body}>
        <div style={s.bodyHeader}>
          <Badge color={o.color} bg={o.bg} icon={o.icon}>
            {t(`runStatus.${o.key}`)}
          </Badge>
          <Button kind="ghost" size="sm" icon="FileText" onClick={() => onOpenTrace(activeRun.run_id)}>
            {t("multiAgentReview.viewTrace")}
          </Button>
        </div>

        {activeRun.status === "failed" && activeRun.error && (
          <div style={s.errorText}>{activeRun.error}</div>
        )}

        {settled && activeReview && (
          <>
            <div style={s.summaryRow}>
              {activeReview.score != null && <CircularScore score={activeReview.score} size={40} stroke={3.5} />}
              {activeReview.summary && <p style={s.summaryText}>{activeReview.summary}</p>}
            </div>
            <div style={s.findingsList}>
              {activeReview.findings.map((f, i) => (
                <FindingCard
                  key={f.id}
                  f={f}
                  defaultExpanded={i === 0}
                  pending={action.isPending}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
                  onOpenEvalCaseDraft={(draft, seededFrom) => setEvalDraft({ draft, seededFrom })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
