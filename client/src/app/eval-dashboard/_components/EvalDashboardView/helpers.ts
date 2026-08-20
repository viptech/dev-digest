import type { EvalDashboardAgentSummary, EvalDashboardRunSummary } from "@/lib/hooks/evals";

/** One row of the "Recent eval runs · all agents" table (SPEC-05 T14) — an
 *  `EvalDashboardRunSummary` plus the owning agent's name, since the table
 *  flattens every agent's history into one chronological list. */
export interface DashboardHistoryRow extends EvalDashboardRunSummary {
  agent_id: string;
  agent_name: string;
}

/** Flattens every agent's `recent_runs` into one list, sorted newest-first
 *  across agents — pure client-side derivation from the same dashboard
 *  payload `useEvalDashboard()` already fetches, no new endpoint. */
export function flattenRecentRuns(agents: EvalDashboardAgentSummary[]): DashboardHistoryRow[] {
  return agents
    .flatMap((a) => a.recent_runs.map((r) => ({ ...r, agent_id: a.agent_id, agent_name: a.agent_name })))
    .sort((a, b) => (a.ran_at < b.ran_at ? 1 : a.ran_at > b.ran_at ? -1 : 0));
}
