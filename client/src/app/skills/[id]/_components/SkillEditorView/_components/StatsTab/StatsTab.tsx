"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BarRow, Donut, Icon } from "@devdigest/ui";
import { useSkillStats } from "@/lib/hooks/skills";
import { s } from "./styles";

/**
 * Stats tab (SPEC-06 G6, Development Plan `skill-editor.md` Step 8) —
 * consumes the already-verified `GET /skills/:id/stats` (Step 3) via
 * `useSkillStats`. `used_by_agents`/`pull_rate`/`accept_rate` tiles, a
 * `BarRow` list of agents linking this skill, and a "Findings by category"
 * `Donut` in dollars (AC-22–AC-27).
 *
 * `null` pull_rate/accept_rate render as "—", never "0%" (AC-24, AC-25) — the
 * same vacuous-null convention as the agent editor's `StatsTab`
 * (`stats-helpers.ts:99`).
 *
 * `Donut` is used with its DEFAULT `valuePrefix="$"` here — unlike the agent
 * `StatsTab` (which overrides it to `""` for raw finding counts),
 * `cost_by_category[].cost_usd` is already in dollars, so the default dollar
 * formatting (`s.value.toFixed(2)`, `Donut.tsx:15,49-51`) is exactly right
 * with no override.
 */
const CATEGORY_COLORS = ["var(--crit)", "var(--warn)", "var(--accent)", "var(--ok)", "var(--text-muted)"];

export function StatsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading } = useSkillStats(skillId);

  if (isLoading || !stats) {
    return <div style={s.wrap}>{t("stats.loading")}</div>;
  }

  const maxAgentPullRate = Math.max(...stats.agents.map((a) => a.pull_rate ?? 0), 0.01);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard
          label={t("stats.usedByAgents")}
          value={t("stats.usedByAgentsValue", { count: stats.used_by_agents })}
        />
        <MetricCard
          label={t("stats.pullRate")}
          value={stats.pull_rate != null ? `${Math.round(stats.pull_rate * 100)}%` : "—"}
        />
        <MetricCard
          label={t("stats.acceptRate")}
          value={stats.accept_rate != null ? `${Math.round(stats.accept_rate * 100)}%` : "—"}
        />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Users size={14} /> {t("stats.agentsUsingSkill")}
          </div>
          {stats.agents.length === 0 ? (
            <p style={s.emptyNote}>{t("stats.noAgents")}</p>
          ) : (
            stats.agents.map((agent) => (
              <BarRow
                key={agent.agent_id}
                label={agent.agent_name}
                value={agent.pull_rate ?? 0}
                max={maxAgentPullRate}
                suffix={agent.pull_rate != null ? `${Math.round(agent.pull_rate * 100)}%` : "—"}
              />
            ))
          )}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Boxes size={14} /> {t("stats.findingsByCategory")}
          </div>
          {stats.cost_by_category.length === 0 ? (
            <p style={s.emptyNote}>{t("stats.noCost")}</p>
          ) : (
            <Donut
              segments={stats.cost_by_category.map((c, i) => ({
                label: c.category,
                value: c.cost_usd,
                color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!,
              }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
