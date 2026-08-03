"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BarRow, Donut, Icon, Badge } from "@devdigest/ui";
import { useAgentStats } from "../../../../../../../lib/hooks/agents";
import RunTraceDrawer from "../../../../../../repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { s } from "./styles";

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

export function StatsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const { data: stats, isLoading } = useAgentStats(agentId);
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);

  if (isLoading || !stats) {
    return <div style={s.wrap}>{t("stats.loading")}</div>;
  }

  const maxSkillPct = Math.max(...stats.most_used_skills.map((s2) => s2.pct), 0.01);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label={t("stats.totalRuns")} value={stats.runs} />
        <MetricCard
          label={t("stats.avgCostPerRun")}
          value={stats.avg_cost_usd != null ? `$${stats.avg_cost_usd.toFixed(2)}` : "—"}
        />
        <MetricCard
          label={t("stats.avgDuration")}
          value={stats.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
        />
        <MetricCard
          label={t("stats.acceptRate")}
          value={stats.accept_rate != null ? `${Math.round(stats.accept_rate * 100)}%` : "—"}
        />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Sparkles size={14} /> {t("stats.mostUsedSkills")}
          </div>
          {stats.most_used_skills.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("stats.noSkillsUsed")}</p>}
          {stats.most_used_skills.map((skill) => (
            <BarRow
              key={skill.skill_id}
              label={skill.name}
              value={skill.pct}
              max={maxSkillPct}
              suffix={`${Math.round(skill.pct * 100)}%`}
            />
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.AlertTriangle size={14} /> {t("stats.findingsBySeverity")}
          </div>
          {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => (
            <BarRow
              key={sev}
              label={sev}
              value={stats.findings_by_severity[sev]}
              max={Math.max(stats.findings_by_severity.CRITICAL, stats.findings_by_severity.WARNING, stats.findings_by_severity.SUGGESTION, 1)}
              color={SEVERITY_COLOR[sev]}
              suffix={String(stats.findings_by_severity[sev])}
            />
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Boxes size={14} /> {t("stats.findingsByCategory")}
          </div>
          {stats.findings_by_category.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("stats.noFindings")}</p>
          ) : (
            <Donut
              valuePrefix=""
              segments={stats.findings_by_category.map((c, i) => ({
                label: c.category,
                value: c.count,
                color: ["var(--crit)", "var(--warn)", "var(--accent)", "var(--ok)", "var(--text-muted)"][i % 5]!,
              }))}
            />
          )}
        </div>
      </div>

      <div style={s.panel}>
        <div style={s.panelTitle}>
          <Icon.History size={14} /> {t("stats.runHistory")}
        </div>
        {stats.run_history.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("stats.noRuns")}</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{t("stats.table.timestamp")}</th>
                <th style={s.th}>{t("stats.table.pr")}</th>
                <th style={s.th}>{t("stats.table.tokens")}</th>
                <th style={s.th}>{t("stats.table.cost")}</th>
                <th style={s.th}>{t("stats.table.findings")}</th>
                <th style={s.th}>{t("stats.table.source")}</th>
                <th style={s.th}>{t("stats.table.trace")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.run_history.map((r) => (
                <tr key={r.run_id}>
                  <td style={s.td}>{new Date(r.ran_at).toLocaleString()}</td>
                  <td style={s.td}>{r.pr_number != null ? `#${r.pr_number}` : "—"}</td>
                  <td style={s.td}>{(r.tokens_in ?? 0) + (r.tokens_out ?? 0)}</td>
                  <td style={s.td}>{r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "—"}</td>
                  <td style={s.td}>{r.findings_count ?? 0}</td>
                  <td style={s.td}>
                    <Badge color="var(--text-muted)">{r.source}</Badge>
                  </td>
                  <td style={s.td}>
                    <button type="button" style={s.traceLink} onClick={() => setTraceRunId(r.run_id)}>
                      {t("stats.viewTrace")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={stats.run_history.find((r) => r.run_id === traceRunId)?.pr_number ?? null}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </div>
  );
}
