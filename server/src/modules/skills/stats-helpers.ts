import type { SkillStats } from '@devdigest/shared';

export interface SkillStatsRun {
  id: string;
  agentId: string;
  costUsd: number | null;
  findingsCount: number | null;
  skillIds: string[] | null;
}

export interface SkillStatsFinding {
  runId: string;
  category: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

export interface SkillStatsInput {
  skillId: string;
  skillName: string;
  /** Distinct agent ids CURRENTLY linking this skill (agent_skills), AC-23. */
  agentIds: string[];
  agentNames: Map<string, string>;
  /** Every 'done' run (30d window) belonging to one of agentIds — the
   *  pull_rate denominator universe (AC-24), whether or not it pulled this
   *  skill. */
  runs: SkillStatsRun[];
  /** Findings from reviews of runs that actually pulled this skill
   *  (skill_ids contains skillId), tagged with their run_id. */
  findings: SkillStatsFinding[];
}

/** Pure aggregation over already-fetched rows — no DB access, fully unit-testable. */
export function computeSkillStats(input: SkillStatsInput): SkillStats {
  const { skillId, skillName, agentIds, agentNames, runs, findings } = input;

  const totalByAgent = new Map<string, number>();
  const pulledByAgent = new Map<string, number>();
  let totalPulledRuns = 0;
  for (const r of runs) {
    totalByAgent.set(r.agentId, (totalByAgent.get(r.agentId) ?? 0) + 1);
    if ((r.skillIds ?? []).includes(skillId)) {
      pulledByAgent.set(r.agentId, (pulledByAgent.get(r.agentId) ?? 0) + 1);
      totalPulledRuns += 1;
    }
  }

  // AC-24: numerator = 'done' runs (30d) of currently-linking agents whose
  // own skill_ids contains this skill; denominator = all such runs of the
  // same agents in the same window. null when denominator is 0 — never `0%`.
  const pullRate = runs.length === 0 ? null : totalPulledRuns / runs.length;

  const agents = agentIds
    .map((agentId) => {
      const total = totalByAgent.get(agentId) ?? 0;
      const pulled = pulledByAgent.get(agentId) ?? 0;
      return {
        agent_id: agentId,
        // Agents are hard-deleted (agent_runs.agent_id is `ON DELETE SET
        // NULL`, but agent_skills is `ON DELETE CASCADE` so a dangling link
        // shouldn't normally exist) — placeholder mirrors the agents-side
        // stats-helpers.ts convention for a name lookup miss regardless.
        agent_name: agentNames.get(agentId) ?? '(deleted agent)',
        pull_rate: total === 0 ? null : pulled / total,
      };
    })
    .sort((a, b) => (b.pull_rate ?? 0) - (a.pull_rate ?? 0));

  // AC-25: accept_rate over findings belonging to reviews of runs that
  // actually pulled this skill — vacuous null (not 0) when no finding has a
  // decision yet, same convention as AgentStats.accept_rate (stats-helpers.ts:99).
  const accepted = findings.filter((f) => f.acceptedAt != null).length;
  const dismissed = findings.filter((f) => f.dismissedAt != null).length;
  const acted = accepted + dismissed;
  const acceptRate = acted === 0 ? null : accepted / acted;

  // AC-26: for each run in the AC-24 numerator set with a non-null costUsd
  // and a non-zero findingsCount, split costUsd evenly across ITS OWN
  // findings (costUsd / findingsCount per finding) and sum the per-finding
  // share into that finding's category. A run with findingsCount === 0 or
  // costUsd === null contributes nothing — no NaN, no divide-by-zero. The
  // explicitly-rejected alternative (attributing the FULL costUsd to every
  // category represented among a run's findings) is deliberately NOT
  // implemented — it would make the category sums exceed the run's actual
  // cost.
  const perRunShare = new Map<string, number>();
  for (const r of runs) {
    if (!(r.skillIds ?? []).includes(skillId)) continue;
    if (r.costUsd == null || !r.findingsCount) continue;
    perRunShare.set(r.id, r.costUsd / r.findingsCount);
  }
  const costByCategory = new Map<string, number>();
  for (const f of findings) {
    const share = perRunShare.get(f.runId);
    if (share == null) continue;
    costByCategory.set(f.category, (costByCategory.get(f.category) ?? 0) + share);
  }

  return {
    skill_id: skillId,
    skill_name: skillName,
    used_by_agents: agentIds.length,
    pull_rate: pullRate,
    accept_rate: acceptRate,
    agents,
    cost_by_category: [...costByCategory.entries()].map(([category, cost_usd]) => ({ category, cost_usd })),
  };
}
