import type { AgentStats } from '@devdigest/shared';

export interface StatsRun {
  id: string;
  ranAt: Date;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  findingsCount: number | null;
  skillIds: string[] | null;
  prNumber: number | null;
  source: 'local' | 'ci';
}

export interface StatsFinding {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

export interface StatsInput {
  agentId: string;
  agentName: string;
  runs: StatsRun[];
  findings: StatsFinding[];
  skillNames: Map<string, string>;
}

const MAX_MOST_USED_SKILLS = 5;
const MAX_RUN_HISTORY = 10;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pure aggregation over already-fetched rows — no DB access, fully unit-testable. */
export function computeAgentStats(input: StatsInput): AgentStats {
  const { runs, findings, skillNames } = input;

  const costs = runs.map((r) => r.costUsd).filter((v): v is number => v != null);
  const durations = runs.map((r) => r.durationMs).filter((v): v is number => v != null);
  const findingCounts = runs.map((r) => r.findingsCount).filter((v): v is number => v != null);

  const accepted = findings.filter((f) => f.acceptedAt != null).length;
  const dismissed = findings.filter((f) => f.dismissedAt != null).length;
  const pending = findings.length - accepted - dismissed;
  const acted = accepted + dismissed;

  const bySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  const byCategory = new Map<string, number>();
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }

  const skillRunCounts = new Map<string, number>();
  for (const r of runs) {
    for (const id of r.skillIds ?? []) {
      skillRunCounts.set(id, (skillRunCounts.get(id) ?? 0) + 1);
    }
  }
  const mostUsedSkills = [...skillRunCounts.entries()]
    .map(([skillId, count]) => ({
      skill_id: skillId,
      name: skillNames.get(skillId) ?? skillId,
      pct: runs.length === 0 ? 0 : count / runs.length,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_MOST_USED_SKILLS);

  const runHistory = [...runs]
    .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
    .slice(0, MAX_RUN_HISTORY)
    .map((r) => ({
      run_id: r.id,
      ran_at: r.ranAt.toISOString(),
      pr_number: r.prNumber,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
      cost_usd: r.costUsd,
      findings_count: r.findingsCount,
      source: r.source,
    }));

  return {
    agent_id: input.agentId,
    agent_name: input.agentName,
    runs: runs.length,
    findings_total: findings.length,
    accepted,
    dismissed,
    pending,
    accept_rate: acted === 0 ? null : accepted / acted,
    dismiss_rate: acted === 0 ? null : dismissed / acted,
    avg_findings_per_run: avg(findingCounts),
    total_cost_usd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
    avg_cost_usd: avg(costs),
    avg_latency_ms: avg(durations),
    findings_by_severity: bySeverity,
    trend: [...runs]
      .sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime())
      .map((r) => ({ label: r.ranAt.toISOString().slice(0, 10), value: r.costUsd ?? 0 })),
    most_used_skills: mostUsedSkills,
    findings_by_category: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    run_history: runHistory,
  };
}
