"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Toggle, SelectInput, Badge } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useCiRuns, useRefreshCi } from "@/lib/hooks/ci";
import { useAgents } from "@/lib/hooks/agents";
import { statusI18nKey, distinctSources, sevenDaysAgoIso } from "./helpers";
import { s } from "./styles";

/** Polling interval (ms) for the auto-refresh toggle — re-reads `GET
 *  /ci/runs` only (a cheap read, no GitHub call); it does NOT re-trigger
 *  the ingest cycle itself (that stays a deliberate, rate-limited action
 *  behind the "Refresh" button, `POST /ci/refresh` via `useRefreshCi`) —
 *  see this session's report for why "refetchInterval on the same query"
 *  was read as the GET, not the POST. */
const AUTO_REFRESH_INTERVAL_MS = 15_000;

/**
 * CI Runs — the global, workspace-wide page (SPEC-08 T14). Every agent's CI
 * run history in one table (AC-27/AC-28), filterable by date window/agent/
 * repo/status/source (AC-30's DISTINCT-repo "All repos" filter), a "Trace"
 * link that opens `github_url` in a new tab rather than an internal drawer
 * (AC-29), a manual "Refresh" (triggers the pull-model ingest cycle,
 * `POST /ci/refresh`) and an "auto-refresh" toggle that just keeps the
 * table's own read query current on an interval.
 */
export function CiRunsView() {
  const t = useTranslations("ci");
  const { data: agents } = useAgents();
  const refreshCi = useRefreshCi();

  const [status, setStatus] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [source, setSource] = React.useState("");
  const [autoRefresh, setAutoRefresh] = React.useState(false);

  const since = React.useMemo(sevenDaysAgoIso, []);

  const { data, isLoading, isError, refetch } = useCiRuns(
    { since, status: status || undefined, agentId: agentId || undefined, repo: repo || undefined, source: source || undefined },
    { refetchInterval: autoRefresh ? AUTO_REFRESH_INTERVAL_MS : false },
  );

  const runs = data?.runs ?? [];
  const repoOptions = data?.repos ?? [];
  const sourceOptions = distinctSources(runs);

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.headerActions}>
            <div style={s.autoRefreshRow}>
              <Toggle on={autoRefresh} onChange={setAutoRefresh} size={14} />
              <span>{t("runs.autoRefresh")}</span>
            </div>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={() => refreshCi.mutate()}
              loading={refreshCi.isPending}
            >
              {refreshCi.isPending ? t("runs.refreshing") : t("runs.refresh")}
            </Button>
          </div>
        </div>

        <div style={s.filtersRow}>
          <div style={s.filterSelect}>
            <SelectInput value="7d" options={[{ value: "7d", label: t("runs.filters.last7Days") }]} mono={false} />
          </div>
          <div style={s.filterSelect}>
            <SelectInput
              value={agentId}
              onChange={setAgentId}
              options={[{ value: "", label: t("runs.filters.allAgents") }, ...(agents ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              mono={false}
            />
          </div>
          <div style={s.filterSelect}>
            <SelectInput
              value={repo}
              onChange={setRepo}
              options={[{ value: "", label: t("runs.filters.allRepos") }, ...repoOptions.map((r) => ({ value: r, label: r }))]}
            />
          </div>
          <div style={s.filterSelect}>
            <SelectInput
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("runs.filters.allStatuses") },
                { value: "succeeded", label: t("runs.status.succeeded") },
                { value: "no_findings", label: t("runs.status.noFindings") },
                { value: "failed", label: t("runs.status.failed") },
                { value: "running", label: t("runs.status.running") },
              ]}
              mono={false}
            />
          </div>
          <div style={s.filterSelect}>
            <SelectInput
              value={source}
              onChange={setSource}
              options={[{ value: "", label: t("runs.filters.allSources") }, ...sourceOptions.map((src) => ({ value: src, label: src }))]}
              mono={false}
            />
          </div>
        </div>

        {isLoading && <Skeleton height={200} />}
        {isError && <ErrorState body={t("exportWizard.genericError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && runs.length === 0 && (
          <EmptyState icon="Activity" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        )}

        {!isLoading && !isError && runs.length > 0 && (
          <div style={s.panel}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("runs.table.timestamp")}</th>
                  <th style={s.th}>{t("runs.table.pullRequest")}</th>
                  <th style={s.th}>{t("runs.table.agent")}</th>
                  <th style={s.th}>{t("runs.table.source")}</th>
                  <th style={s.th}>{t("runs.table.duration")}</th>
                  <th style={s.th}>{t("runs.table.findings")}</th>
                  <th style={s.th}>{t("runs.table.cost")}</th>
                  <th style={s.th}>{t("runs.table.status")}</th>
                  <th style={s.th}>{t("runs.table.trace")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td style={s.td}>{run.ran_at ? new Date(run.ran_at).toLocaleString() : "—"}</td>
                    <td style={s.td}>{run.pr_number != null ? `#${run.pr_number}` : "—"}</td>
                    {/* AC-28 Edge case: ci_installation_id: null (deleted agent/installation)
                        must stay visible with an "Agent" fallback, never disappear/throw. */}
                    <td style={s.td}>{run.agent ?? t("runs.agentFallback")}</td>
                    <td style={s.td}>
                      <Badge color="var(--text-muted)">{run.source ?? "—"}</Badge>
                    </td>
                    <td style={s.td}>{run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : "—"}</td>
                    <td style={s.td}>
                      {(run.findings_count ?? 0) === 0 ? (
                        "—"
                      ) : (
                        <span style={s.findingsCell}>
                          {!!run.critical && <span style={s.findingsCritical}>{run.critical}C</span>}
                          {!!run.warning && <span style={s.findingsWarning}>{run.warning}W</span>}
                          {!!run.suggestion && <span style={s.findingsSuggestion}>{run.suggestion}S</span>}
                          {!run.critical && !run.warning && !run.suggestion && <span>{run.findings_count}</span>}
                        </span>
                      )}
                    </td>
                    <td style={s.td}>{run.cost_usd != null ? `$${run.cost_usd.toFixed(2)}` : "—"}</td>
                    <td style={s.td}>{t(`runs.status.${statusI18nKey(run.status)}`)}</td>
                    <td style={s.td}>
                      {run.github_url ? (
                        <a href={run.github_url} target="_blank" rel="noopener" style={s.traceLink}>
                          {t("runs.view")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
