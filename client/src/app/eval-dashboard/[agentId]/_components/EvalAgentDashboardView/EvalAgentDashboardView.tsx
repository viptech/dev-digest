"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, ErrorState, Skeleton, SectionLabel, Sparkline, LineChart } from "@devdigest/ui";
import { useAgent } from "@/lib/hooks/agents";
import { useEvalCases, useEvalRunHistory } from "@/lib/hooks/evals";
import { groupRuns, toggleRunSelection } from "@/lib/eval-runs";
import { METRIC_COLOR } from "@/lib/eval-metrics";
import { AppShell } from "../../../../../components/app-shell";
import { CompareRunsModal } from "../CompareRunsModal";
import { deriveAgentMetricCards, deriveInsightBanner, toChartSeries, withVersions } from "./helpers";
import { s } from "./styles";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Per-agent Eval Dashboard drill-down (SPEC-05 T15) — `/eval-dashboard/:agentId`.
 * A richer, single-agent view of the same set-run history `EvalsTab`'s
 * history section already shows: 3 metric cards with deltas + sparklines, a
 * code-generated insight banner (no LLM call), a full recall/precision/
 * citation trend chart, and a run-history table whose "select exactly 2 →
 * Compare" flow opens `CompareRunsModal` (metric deltas + a system-prompt
 * diff + "Promote").
 */
export function EvalAgentDashboardView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: agent, isLoading: agentLoading, isError: agentError } = useAgent(agentId);
  const { data: historyRows, isLoading: historyLoading, isError: historyError } = useEvalRunHistory({
    ownerKind: "agent",
    ownerId: agentId,
  });
  const { data: cases } = useEvalCases({ ownerKind: "agent", ownerId: agentId });
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const groups = React.useMemo(() => groupRuns(historyRows ?? []), [historyRows]);
  const versioned = React.useMemo(() => withVersions(groups), [groups]);
  const metricCards = React.useMemo(() => deriveAgentMetricCards(groups), [groups]);
  const banner = React.useMemo(() => deriveInsightBanner(groups), [groups]);
  const chartSeries = React.useMemo(
    () => toChartSeries(groups, (key) => METRIC_COLOR[key]),
    [groups],
  );

  const toggleSelection = (id: string) => setSelectedIds((prev) => toggleRunSelection(prev, id));

  const selected = versioned.filter((g) => selectedIds.includes(g.run_group_id));
  const comparePair =
    selected.length === 2
      ? ((selected[0]!.ran_at <= selected[1]!.ran_at ? selected : [selected[1]!, selected[0]!]) as [
          (typeof versioned)[number],
          (typeof versioned)[number],
        ])
      : null;

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval-dashboard" },
    { label: agent?.name ?? "…" },
  ];

  const isLoading = agentLoading || historyLoading;
  const isError = agentError || historyError;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div>
            <h1 style={s.h1}>{agent?.name ?? "…"}</h1>
            <p style={s.subtitle}>{t("agentDashboardPage.subtitle", { count: cases?.length ?? 0 })}</p>
          </div>
          {agent && (
            <Badge color="var(--text-secondary)" mono>
              {agent.provider}/{agent.model}
            </Badge>
          )}
        </div>

        {isLoading && <Skeleton height={64} />}
        {isError && <ErrorState body={t("agentDashboardPage.loadError")} />}

        {!isLoading && !isError && (
          <>
            {banner && <div style={s.banner}>{banner}</div>}

            {metricCards && (
              <div style={s.metricsRow}>
                {metricCards.map((card) => (
                  <div key={card.key} style={s.metricCard}>
                    <div style={s.metricCardLabel}>{t(`agentDashboardPage.metricLabels.${card.key}`)}</div>
                    <div style={s.metricCardValueRow}>
                      <span style={s.metricCardValue(METRIC_COLOR[card.key])}>{pct(card.value)}</span>
                      {card.delta != null && (
                        <span style={s.metricCardDelta(card.delta >= 0)}>
                          {card.delta >= 0 ? "▲" : "▼"} {pct(Math.abs(card.delta))}
                        </span>
                      )}
                    </div>
                    <Sparkline data={card.sparkline} color={METRIC_COLOR[card.key]} />
                  </div>
                ))}
              </div>
            )}

            <div style={s.sectionHeadingWrap}>
              <SectionLabel icon="TrendingUp">{t("agentDashboardPage.trendHeading")}</SectionLabel>
            </div>
            {groups.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("agentDashboardPage.noHistory")}</p>
            ) : (
              <div style={s.chartWrap}>
                <LineChart series={chartSeries} />
              </div>
            )}

            <div style={s.sectionHeadingWrap}>
              <SectionLabel icon="History">{t("agentDashboardPage.historyHeading")}</SectionLabel>
            </div>
            {groups.length > 0 && (
              <div style={s.historyTable}>
                <div style={s.historyHeaderRow}>
                  <span />
                  <span>{t("agentDashboardPage.versionColumn")}</span>
                  <span>{t("agentDashboardPage.ranAtColumn")}</span>
                  <span>{t("agentDashboardPage.metricLabels.recall")}</span>
                  <span>{t("agentDashboardPage.metricLabels.precision")}</span>
                  <span>{t("agentDashboardPage.metricLabels.citation_accuracy")}</span>
                  <span />
                </div>
                {versioned.map((g) => (
                  <div key={g.run_group_id} style={s.historyRow}>
                    <input
                      type="checkbox"
                      aria-label={t("agentDashboardPage.selectToCompare")}
                      checked={selectedIds.includes(g.run_group_id)}
                      onChange={() => toggleSelection(g.run_group_id)}
                    />
                    <span style={s.historyVersion}>v{g.version}</span>
                    <span style={s.historyMeta}>{new Date(g.ran_at).toLocaleString()}</span>
                    <span>{pct(g.aggregate.recall)}</span>
                    <span>{pct(g.aggregate.precision)}</span>
                    <span>{pct(g.aggregate.citation_accuracy)}</span>
                    <span>
                      {t("agentDashboardPage.passCount", {
                        passed: g.cases.filter((c) => c.pass === true).length,
                        total: g.cases.length,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={s.compareBar}>
              {groups.length > 0 && selectedIds.length !== 2 && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("agentDashboardPage.comparePrompt")}</span>
              )}
              <Button kind="primary" size="sm" disabled={selectedIds.length !== 2} onClick={() => setComparing(true)}>
                {t("agentDashboardPage.compare")}
              </Button>
            </div>

            {comparing && comparePair && (
              <CompareRunsModal agentId={agentId} older={comparePair[0]} newer={comparePair[1]} onClose={() => setComparing(false)} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
