/* MultiAgentReviewTab — SPEC-07 T9 (G7). Shell for the new "Multi-Agent
   Review" PR tab: empty state + "Start New Review" on a first visit (AC-2),
   the newest past group run shown immediately with "Start New Review" still
   visible on a return visit (AC-3, G7 — "last run instead of an auto-picker"),
   and swapping the tab's own content (not a modal, not a navigation) to
   `ConfigureRunScreen` when that button is clicked (AC-4).

   The "results" content here is intentionally the same `RunHistory` list
   already used by the "Agent runs" tab (`FindingsTab.tsx`), filtered to just
   this group's runs — the dedicated card-layout `ColumnsView`/tab-layout
   `TabsDetailView` (T11/T12, same data, per AC-26's "same data RunHistory
   already renders, just card- not row-layout") are a later group's work; this
   shell is what they'll render inside (see the Development Plan's Implementer
   4 "depends on" note). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SectionLabel } from "@devdigest/ui";
import { groupRuns } from "@/lib/multi-agent-runs";
import { RunHistory } from "../RunHistory/RunHistory";
import { ConfigureRunScreen } from "../ConfigureRunScreen";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

interface MultiAgentReviewTabProps {
  prId: string | null;
  prRuns: RunSummary[] | undefined;
  /** Persisted reviews for this PR (already loaded at the page level via
   *  `usePrReviews`) — passed straight through to `RunHistory` for its
   *  per-run findings-by-severity breakdown, no extra fetch. */
  reviews: ReviewRecord[];
  onOpenTrace: (runId: string) => void;
  /** Fired once a new group run has actually been created (AC-9) — the
   *  caller re-invalidates `usePrRuns`'s cache so the new group's rows show
   *  up (they don't exist in that cache yet at the moment the request
   *  settles). Mirrors `PrDetailHeader`'s existing `onRunsStarted` prop. */
  onRunsStarted?: () => void;
}

export function MultiAgentReviewTab({
  prId,
  prRuns,
  reviews,
  onOpenTrace,
  onRunsStarted,
}: MultiAgentReviewTabProps) {
  const t = useTranslations("prReview");
  const [configuring, setConfiguring] = React.useState(false);
  // Set right after AC-9's response, so the results view shows THAT group
  // even for the brief window before `usePrRuns` (invalidated via
  // `onRunsStarted`) has refetched the rows that belong to it. `null` means
  // "just show the newest group" (the everyday AC-3 case).
  const [pendingGroupId, setPendingGroupId] = React.useState<string | null>(null);
  // Fallback for a submission where `run_group_id` came back `null` (exactly
  // one agent checked, AC-15 — no `multi_agent_runs` row exists to group by).
  // SPEC-07's own Edge cases section is explicit that this must still show
  // that one result on this tab, not silently fall back to whatever group
  // was showing before (or the empty state) — `groupRuns` itself correctly
  // drops null-group rows (they could just as easily be an unrelated
  // single-agent run from the legacy `RunReviewDropdown` path), so the
  // degenerate one-run "group" for THIS submission has to be built here,
  // from the specific `run_id`s the mutation response named.
  const [pendingRunIds, setPendingRunIds] = React.useState<string[] | null>(null);

  const groups = React.useMemo(() => groupRuns(prRuns ?? []), [prRuns]);
  const pendingSingleRunGroup = React.useMemo(() => {
    if (pendingGroupId || !pendingRunIds || pendingRunIds.length === 0) return null;
    const runs = (prRuns ?? []).filter((r) => pendingRunIds.includes(r.run_id));
    if (runs.length === 0) return null; // not in the cache yet — nothing to show this tick
    const ranAt = runs.reduce((max, r) => ((r.ran_at ?? "") > max ? r.ran_at ?? "" : max), runs[0]!.ran_at ?? "");
    return { multi_agent_run_id: "pending-single", ran_at: ranAt, runs };
  }, [pendingGroupId, pendingRunIds, prRuns]);
  const activeGroup = pendingGroupId
    ? groups.find((g) => g.multi_agent_run_id === pendingGroupId) ?? null
    : pendingSingleRunGroup ?? groups[0] ?? null;

  const handleSubmitted = (runGroupId: string | null, runIds: string[]) => {
    setPendingGroupId(runGroupId);
    setPendingRunIds(runGroupId ? null : runIds);
    setConfiguring(false);
    onRunsStarted?.();
  };

  if (configuring && prId) {
    return <ConfigureRunScreen prId={prId} onCancel={() => setConfiguring(false)} onSubmitted={handleSubmitted} />;
  }

  return (
    <section>
      <SectionLabel
        icon="Users"
        right={
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setConfiguring(true)}>
            {t("multiAgentReview.startNewReview")}
          </Button>
        }
      >
        {t("multiAgentReview.title")}
      </SectionLabel>

      {!activeGroup ? (
        <EmptyState
          icon="Users"
          title={t("multiAgentReview.emptyTitle")}
          body={t("multiAgentReview.emptyBody")}
        />
      ) : (
        <div style={s.results}>
          <RunHistory runs={activeGroup.runs} reviews={reviews} onOpenTrace={onOpenTrace} />
        </div>
      )}
    </section>
  );
}
