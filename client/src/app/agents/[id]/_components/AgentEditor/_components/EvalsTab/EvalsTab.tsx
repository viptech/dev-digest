"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Badge, SectionLabel, Icon, SEV, CAT } from "@devdigest/ui";
import type { EvalExpectation } from "@devdigest/shared";
import {
  useEvalCases,
  useRunEvalCase,
  useDeleteEvalCase,
  useRunEvalSet,
  useEvalRunHistory,
} from "../../../../../../../lib/hooks/evals";
import { ApiError } from "../../../../../../../lib/api";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { METRIC_COLOR } from "@/lib/eval-metrics";
import { groupRuns, caseTransitions, toggleRunSelection, type RunGroup } from "@/lib/eval-runs";
import { deriveCaseTag, casesPassingSummary, deriveMetricCards, type CaseTag } from "./helpers";
import { s } from "./styles";

const METRICS = ["recall", "precision", "citation_accuracy"] as const;
type Metric = (typeof METRICS)[number];

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Severity-category tag text for a `must_find` case tag, e.g.
 *  "CRITICAL - security" — built as ONE pre-joined string and rendered in a
 *  plain `<span>` (never split across multiple `<Badge>` interpolations,
 *  client/INSIGHTS.md 2026-08-19 gotcha). `null` when the expectation has
 *  neither severity nor category to show (badge alone still renders). */
function mustFindTagText(tag: Extract<CaseTag, { kind: "must_find" }>): string | null {
  const { severity, category } = tag;
  if (severity && category) return `${SEV[severity].label.toUpperCase()} - ${CAT[category].label}`;
  if (severity) return SEV[severity].label.toUpperCase();
  if (category) return CAT[category].label;
  return null;
}

/** Evals tab — list eval cases for this agent, open the case modal to
 *  create/edit one, run a case, or delete it. Each row shows the last run's
 *  pass/fail result (or "never run") once a run completes.
 *
 *  Also (SPEC-05, T8): a "Run all" button that runs the WHOLE set in one
 *  bulk call, a history list of past set-runs grouped by `run_group_id`
 *  (AC-17, newest first), and — when exactly two set-runs are selected — a
 *  side-by-side comparison of per-metric deltas and per-case pass/fail
 *  transitions (AC-18/AC-19). No "regression"/"improved" indicator is ever
 *  shown for a single run (AC-25); recall/precision/citation_accuracy are
 *  always rendered as separate values, never one collapsed score (AC-24).
 *
 *  Restructured (Development Plan evals-tab-mockup-alignment.md) to match
 *  the course reference mockup: a 4-card eval-metrics header block + a
 *  "View full dashboard →" link above the case list, richer per-case rows
 *  (status icon, MUST FIND/MUST NOT FLAG badge, "expected N, got M"
 *  subtitle, severity-category tag), and reordered Run all/New case
 *  buttons — the Run all/History/Compare sections below are unchanged,
 *  only moved. */
export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading } = useEvalCases(agentId);
  const run = useRunEvalCase(agentId);
  const del = useDeleteEvalCase(agentId);
  const runSet = useRunEvalSet(agentId);
  const { data: historyRows } = useEvalRunHistory(agentId);
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  const [runAllError, setRunAllError] = React.useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = React.useState<string[]>([]);

  const editingCase = editing && editing !== "new" ? cases?.find((c) => c.id === editing) : undefined;
  const groups = React.useMemo(() => groupRuns(historyRows ?? []), [historyRows]);
  // Open Question 3 (Development Plan): `null` when there's no set-run
  // history yet — the caller renders no 4-card row at all in that case.
  const metricCards = React.useMemo(() => deriveMetricCards(groups), [groups]);
  const passingSummary = React.useMemo(() => casesPassingSummary(cases ?? []), [cases]);

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

  const onRunAll = async () => {
    setRunAllError(null);
    try {
      await runSet.mutateAsync();
    } catch (e) {
      setRunAllError(e instanceof ApiError ? e.message : t("evalsTab.runAllFailed"));
    }
  };

  // Selecting a 3rd run drops the oldest selection — comparison is always
  // between exactly the two most-recently-clicked runs (extracted to
  // `@/lib/eval-runs`'s `toggleRunSelection`, T15, so the drill-down page's
  // own run-history table reuses the same rule).
  const toggleGroupSelection = (id: string) => {
    setSelectedGroupIds((prev) => toggleRunSelection(prev, id));
  };

  const selectedGroups = groups.filter((g) => selectedGroupIds.includes(g.run_group_id));
  const comparisonPair: [RunGroup, RunGroup] | null =
    selectedGroups.length === 2
      ? (selectedGroups[0]!.ran_at <= selectedGroups[1]!.ran_at
          ? [selectedGroups[0]!, selectedGroups[1]!]
          : [selectedGroups[1]!, selectedGroups[0]!])
      : null;

  return (
    <div style={s.wrap}>
      {(editing === "new" || editingCase) && (
        <EvalCaseModal agentId={agentId} existing={editingCase} onClose={() => setEditing(null)} />
      )}

      {metricCards && (
        <>
          <div style={s.metricsSectionHeaderRow}>
            <SectionLabel>{t("evalsTab.metricsHeading")}</SectionLabel>
            <Link href="/eval-dashboard" style={s.dashboardLink}>
              {t("evalsTab.viewFullDashboard")}
            </Link>
          </div>
          <div style={s.metricsRow}>
            {metricCards.cards.map((card) => (
              <div key={card.key} style={s.metricCard}>
                {/* Open Question 5: routed through t() (new evalsTab.metricLabels.*
                    keys) for consistency with the rest of this tab, even though
                    EvalDashboardView.tsx hardcodes "RECALL"/"PREC"/"CITE" as
                    literal English JSX text. */}
                <div style={s.metricCardLabel}>{t(`evalsTab.metricLabels.${card.key}`)}</div>
                <div style={s.metricCardValue(METRIC_COLOR[card.key])}>{pct(card.value)}</div>
                {card.delta != null && (
                  <div style={s.metricCardDelta(card.delta >= 0)}>
                    {card.delta >= 0 ? "▲" : "▼"} {t("evalsTab.delta", { value: pct(Math.abs(card.delta)) })}
                  </div>
                )}
              </div>
            ))}
            <div style={s.metricCard}>
              <div style={s.metricCardLabel}>{t("evalsTab.tracesPassedLabel")}</div>
              <div style={s.metricCardValue("var(--text-primary)")}>
                {metricCards.tracesPassed.passed}/{metricCards.tracesPassed.total}
              </div>
            </div>
          </div>
          <p style={s.metricsCaption}>{t("evalsTab.metricsCaption")}</p>
        </>
      )}

      <div style={s.headerRow}>
        <h2 style={s.casesHeading}>{t("evalsTab.casesHeading")}</h2>
        <Badge style={s.passingBadge}>
          {t("evalsTab.passingBadge", { passing: passingSummary.passing, total: passingSummary.total })}
        </Badge>
        <span style={s.casesCountMuted}>{t("evalsTab.casesCount", { count: cases?.length ?? 0 })}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={onRunAll}
            disabled={runSet.isPending || (cases?.length ?? 0) === 0}
          >
            {runSet.isPending ? t("evalsTab.runningAll") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>
      {runAllError && <div style={s.rowError}>{runAllError}</div>}
      {isLoading && <p>{t("evalsTab.loadingCases")}</p>}
      {!isLoading && (cases?.length ?? 0) === 0 && <p>{t("evalsTab.emptyCases")}</p>}
      {(cases ?? []).map((c) => {
        const expected = (c.expected_output ?? []) as EvalExpectation[];
        const tag = deriveCaseTag(expected);
        // Open Question 2: a never-run case has no last_run/actual_count to
        // report — "expected N findings" without a fabricated "got 0" clause.
        const subtitle = c.last_run
          ? t("evalsTab.expectedGot", { expected: expected.length, got: c.last_run.actual_count })
          : t("evalsTab.expectedOnly", { expected: expected.length });
        const tagText = tag && tag.kind === "must_find" ? mustFindTagText(tag) : null;

        return (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
            <div style={s.caseRow}>
              {c.last_run ? (
                c.last_run.pass ? (
                  <Icon.CheckCircle size={16} style={s.caseStatusIcon(true)} aria-label={t("evalsTab.passed")} />
                ) : (
                  <Icon.XCircle size={16} style={s.caseStatusIcon(false)} aria-label={t("evalsTab.failed")} />
                )
              ) : (
                <Icon.Dot size={16} style={s.caseStatusIcon(null)} />
              )}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <div style={s.caseNameRow}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => setEditing(c.id)}>
                    {c.name}
                  </span>
                  {!c.last_run && <Badge>{t("evalsTab.neverRun")}</Badge>}
                  {tag && (
                    <Badge style={tag.kind === "must_find" ? s.mustFindBadge : s.mustNotFlagBadge}>
                      {tag.kind === "must_find" ? t("evalsTab.mustFindBadge") : t("evalsTab.mustNotFlagBadge")}
                    </Badge>
                  )}
                </div>
                <div style={s.caseSubtitle}>{subtitle}</div>
              </div>
              {tag && (
                <span style={s.caseTag}>{tag.kind === "must_not_flag" ? t("evalsTab.assertEmpty") : tagText}</span>
              )}
              <div style={s.caseActions}>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Play"
                  aria-label={t("evalsTab.run")}
                  onClick={() => onRun(c.id)}
                  loading={runningId === c.id}
                />
                <Button kind="ghost" size="sm" icon="Edit" aria-label={t("evalsTab.edit")} onClick={() => setEditing(c.id)} />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Trash"
                  aria-label={t("evalsTab.delete")}
                  onClick={() => onDelete(c.id)}
                  disabled={deletingId === c.id}
                />
              </div>
            </div>
            {rowErrors[c.id] && <div style={s.rowError}>{rowErrors[c.id]}</div>}
          </div>
        );
      })}

      <div style={{ ...s.headerRow, marginTop: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.historyHeading")}</h2>
      </div>
      {groups.length === 0 && <p>{t("evalsTab.noHistory")}</p>}
      {groups.map((g) => (
        <div key={g.run_group_id} style={{ ...s.row, marginBottom: 6 }}>
          <input
            type="checkbox"
            aria-label={t("evalsTab.selectToCompare")}
            checked={selectedGroupIds.includes(g.run_group_id)}
            onChange={() => toggleGroupSelection(g.run_group_id)}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{new Date(g.ran_at).toLocaleString()}</span>
          <span style={{ fontSize: 12 }}>{t("evalsTab.historyCasesCount", { count: g.cases.length })}</span>
          <span style={{ fontSize: 12 }}>recall {pct(g.aggregate.recall)}</span>
          <span style={{ fontSize: 12 }}>precision {pct(g.aggregate.precision)}</span>
          <span style={{ fontSize: 12 }}>citation {pct(g.aggregate.citation_accuracy)}</span>
        </div>
      ))}

      {groups.length > 0 && selectedGroupIds.length !== 2 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evalsTab.comparePrompt")}</p>}

      {comparisonPair && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("evalsTab.compareHeading")}</h3>
          {METRICS.map((metric: Metric) => {
            const older = comparisonPair[0].aggregate[metric];
            const newer = comparisonPair[1].aggregate[metric];
            const delta = newer - older;
            const up = delta >= 0;
            return (
              <div key={metric} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, marginBottom: 4 }}>
                <span style={{ width: 110, textTransform: "uppercase", color: "var(--text-muted)" }}>{metric}</span>
                <span>
                  {t("evalsTab.compareOlder")}: {pct(older)}
                </span>
                <span>
                  {t("evalsTab.compareNewer")}: {pct(newer)}
                </span>
                <span style={{ color: up ? "var(--ok)" : "var(--crit)", fontWeight: 700 }}>
                  {up ? "▲" : "▼"} {t("evalsTab.delta", { value: pct(Math.abs(delta)) })}
                </span>
              </div>
            );
          })}

          <h4 style={{ fontSize: 13, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>{t("evalsTab.caseTransitions")}</h4>
          {caseTransitions(comparisonPair[0], comparisonPair[1]).map((tr) => (
            <div key={tr.case_id} style={{ display: "flex", gap: 10, fontSize: 12, marginBottom: 2 }}>
              <span style={{ flex: 1 }}>{tr.case_name ?? tr.case_id}</span>
              <span>{tr.oldPass === undefined ? t("evalsTab.noData") : tr.oldPass ? t("evalsTab.casePassed") : t("evalsTab.caseFailed")}</span>
              <span>→</span>
              <span>{tr.newPass === undefined ? t("evalsTab.noData") : tr.newPass ? t("evalsTab.casePassed") : t("evalsTab.caseFailed")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
