"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, EmptyState, ErrorState, Skeleton, Sparkline, SectionLabel, Icon } from "@devdigest/ui";
import { useEvalDashboard, useRunAllAgentEvalSets } from "@/lib/hooks/evals";
import { AppShell } from "../../../../components/app-shell";
import { flattenRecentRuns } from "./helpers";
import { s, METRIC_COLOR } from "./styles";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Eval Dashboard (SPEC-05 T9, T14) — workspace-wide: every agent with its
 * cases count and its full set-run history. An agent that has never had a
 * set-run shows a "Never run" empty state per-row, without erroring the
 * whole page (AC-21). recall/precision/citation_accuracy are always
 * rendered as separate values (AC-24, same rule as EvalsTab).
 *
 * T14 adds: a per-agent recall sparkline over `recent_runs`, an ordinal
 * run "v{N}" (per-agent set-run counter, unrelated to agent config
 * versioning), a "Run all agents" button (client-side loop over the
 * existing per-agent bulk-run endpoint — no new bulk-of-bulk route), and a
 * "Recent eval runs · all agents" table flattening every agent's history.
 *
 * T15: clicking a card now navigates to that agent's own drill-down page
 * (`/eval-dashboard/:agentId`) instead of `/agents/:id?tab=evals` — the
 * Evals tab (T8) remains a separate, independent path to the same data.
 */
export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: agents, isLoading, isError, refetch } = useEvalDashboard();
  const runAll = useRunAllAgentEvalSets();
  const [runAllMessage, setRunAllMessage] = React.useState<string | null>(null);

  const onRunAllAgents = async () => {
    setRunAllMessage(null);
    const ids = (agents ?? []).map((a) => a.agent_id);
    if (ids.length === 0) return;
    const result = await runAll.mutateAsync(ids);
    if (result.failed > 0) {
      setRunAllMessage(t("dashboardPage.runAllPartialFailure", { failed: result.failed, total: result.total }));
    }
  };

  const historyRows = React.useMemo(() => flattenRecentRuns(agents ?? []), [agents]);

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div style={s.header}>
            <h1 style={s.h1}>{t("dashboardPage.title")}</h1>
            <p style={s.subtitle}>{t("dashboardPage.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            onClick={onRunAllAgents}
            disabled={runAll.isPending || (agents?.length ?? 0) === 0}
          >
            {runAll.isPending ? t("dashboardPage.runningAllAgents") : t("dashboardPage.runAllAgents")}
          </Button>
        </div>

        {runAllMessage && <div style={s.warnNotice}>{runAllMessage}</div>}

        {isLoading && <Skeleton height={64} />}
        {isError && <ErrorState body={t("dashboardPage.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && (agents?.length ?? 0) === 0 && (
          <EmptyState icon="FlaskConical" title={t("dashboardPage.emptyTitle")} body={t("dashboardPage.emptyBody")} />
        )}

        {!isLoading && !isError && (agents?.length ?? 0) > 0 && <SectionLabel icon="Cpu">{t("dashboardPage.agentsHeading")}</SectionLabel>}

        {(agents ?? []).map((a) => (
          <div key={a.agent_id} style={s.card} onClick={() => router.push(`/eval-dashboard/${a.agent_id}`)}>
            <div style={s.cardMain}>
              <div style={s.cardNameRow}>
                <span style={s.name}>{a.agent_name}</span>
                <Badge>{a.agent_model}</Badge>
              </div>
              <div style={s.muted}>
                {t("dashboardPage.casesCount", { count: a.cases_total })}
                {a.last_run &&
                  " · " +
                    t("dashboardPage.lastRunVersion", {
                      version: a.last_run.version,
                      when: new Date(a.last_run.ran_at).toLocaleString(),
                      passed: a.last_run.cases_passed,
                      total: a.last_run.cases_total,
                    })}
              </div>
            </div>

            {a.last_run ? (
              <>
                <div style={s.sparklineWrap}>
                  <Sparkline
                    data={a.recent_runs
                      .slice()
                      .reverse()
                      .map((r) => r.recall)}
                    color={METRIC_COLOR.recall}
                  />
                </div>
                <div style={s.metricsGroup}>
                  <div style={s.metricCol}>
                    <span style={s.metricLabel}>RECALL</span>
                    <span style={s.metricValue(METRIC_COLOR.recall)}>{pct(a.last_run.recall)}</span>
                  </div>
                  <div style={s.metricCol}>
                    <span style={s.metricLabel}>PREC</span>
                    <span style={s.metricValue(METRIC_COLOR.precision)}>{pct(a.last_run.precision)}</span>
                  </div>
                  <div style={s.metricCol}>
                    <span style={s.metricLabel}>CITE</span>
                    <span style={s.metricValue(METRIC_COLOR.citation_accuracy)}>
                      {pct(a.last_run.citation_accuracy)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <Badge>{t("dashboardPage.neverRun")}</Badge>
            )}
            <Icon.ChevronRight size={16} style={s.cardChevron} />
          </div>
        ))}

        {(agents?.length ?? 0) > 0 && (
          <>
            <div style={s.sectionHeadingWrap}>
              <SectionLabel icon="History">{t("dashboardPage.recentRunsHeading")}</SectionLabel>
            </div>
            {historyRows.length === 0 ? (
              <p style={s.muted}>{t("dashboardPage.recentRunsEmpty")}</p>
            ) : (
              <div style={s.historyTable}>
                {historyRows.map((r) => (
                  <div key={`${r.agent_id}-${r.run_group_id}`} style={s.historyRow}>
                    <span style={s.historyAgent}>{r.agent_name}</span>
                    <span style={s.historyMeta}>{new Date(r.ran_at).toLocaleString()}</span>
                    <span style={s.historyVersion}>v{r.version}</span>
                    <div style={s.barCell}>
                      <div style={s.barTrack}>
                        <div style={s.barFill(r.recall * 100, METRIC_COLOR.recall)} />
                      </div>
                      <span style={s.barPct}>{pct(r.recall)}</span>
                    </div>
                    <div style={s.barCell}>
                      <div style={s.barTrack}>
                        <div style={s.barFill(r.precision * 100, METRIC_COLOR.precision)} />
                      </div>
                      <span style={s.barPct}>{pct(r.precision)}</span>
                    </div>
                    <div style={s.barCell}>
                      <div style={s.barTrack}>
                        <div style={s.barFill(r.citation_accuracy * 100, METRIC_COLOR.citation_accuracy)} />
                      </div>
                      <span style={s.barPct}>{pct(r.citation_accuracy)}</span>
                    </div>
                    <span style={s.historyPassCount}>
                      {r.cases_passed}/{r.cases_total}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
