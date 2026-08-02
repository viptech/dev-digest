"use client";

import React from "react";
import { MetricCard, BarRow, Donut, Icon, Badge } from "@devdigest/ui";
import { useAgentStats } from "../../../../../../../lib/hooks/agents";
import { s } from "./styles";

// This tab uses literal English labels throughout rather than i18n keys —
// none of the headline-tile/panel copy exists yet in agents.json, and
// inventing a parallel ad-hoc namespace for a handful of labels isn't
// worth it; add proper i18n keys in a follow-up pass if this ships broadly.
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

export function StatsTab({ agentId }: { agentId: string }) {
  const { data: stats, isLoading } = useAgentStats(agentId);

  if (isLoading || !stats) {
    return <div style={s.wrap}>Loading stats…</div>;
  }

  const maxSkillPct = Math.max(...stats.most_used_skills.map((s2) => s2.pct), 0.01);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label="TOTAL RUNS (30D)" value={stats.runs} />
        <MetricCard
          label="AVG COST / RUN"
          value={stats.avg_cost_usd != null ? `$${stats.avg_cost_usd.toFixed(2)}` : "—"}
        />
        <MetricCard
          label="AVG DURATION"
          value={stats.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
        />
        <MetricCard
          label="ACCEPT RATE"
          value={stats.accept_rate != null ? `${Math.round(stats.accept_rate * 100)}%` : "—"}
        />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Sparkles size={14} /> Most-used skills
          </div>
          {stats.most_used_skills.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No skills used in this window.</p>}
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
            <Icon.AlertTriangle size={14} /> Findings by severity
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
            <Icon.Boxes size={14} /> Findings by category
          </div>
          {stats.findings_by_category.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No findings in this window.</p>
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
          <Icon.History size={14} /> Run history
        </div>
        {stats.run_history.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No runs yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Timestamp</th>
                <th style={s.th}>PR</th>
                <th style={s.th}>Tokens</th>
                <th style={s.th}>Cost</th>
                <th style={s.th}>Findings</th>
                <th style={s.th}>Source</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
