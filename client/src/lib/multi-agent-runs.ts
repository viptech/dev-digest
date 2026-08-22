import type { RunSummary } from "@devdigest/shared";

/**
 * One multi-agent group run: every `agent_runs` row (surfaced as a
 * `RunSummary` by `GET /pulls/:id/runs`) that shares one
 * `multi_agent_run_id` (SPEC-07 AC-14/AC-17).
 *
 * Modeled after `client/src/lib/eval-runs.ts`'s `RunGroup`/`groupRuns` shape
 * (root `CLAUDE.md` react-ui-architecture note, `.claude/plans/
 * multi-agent-review.md` Constraints) — same "compute on read" principle:
 * the server never persists a grouping view, the client derives it from the
 * flat run list it already fetches via `usePrRuns`.
 */
export interface MultiAgentRunGroup {
  multi_agent_run_id: string;
  /** Max `ran_at` among the group's runs — used to sort groups newest-first. */
  ran_at: string;
  runs: RunSummary[];
}

/**
 * Group a PR's run history (`RunSummary[]`, e.g. from `usePrRuns`) by
 * `multi_agent_run_id`, newest group first. Rows with a `null`
 * `multi_agent_run_id` are single-agent runs (a lone `agentId`, or `all:true`
 * with 0/1 enabled agents) — out of scope for the Multi-Agent Review tab —
 * and are dropped, same as `groupRuns` drops rows with a `null`
 * `run_group_id` in `eval-runs.ts`.
 */
export function groupRuns(rows: RunSummary[]): MultiAgentRunGroup[] {
  const byGroup = new Map<string, RunSummary[]>();
  for (const row of rows) {
    if (!row.multi_agent_run_id) continue;
    const list = byGroup.get(row.multi_agent_run_id) ?? [];
    list.push(row);
    byGroup.set(row.multi_agent_run_id, list);
  }
  const groups: MultiAgentRunGroup[] = Array.from(byGroup.entries()).map(
    ([multi_agent_run_id, runs]) => {
      const ranAt = runs.reduce(
        (max, r) => ((r.ran_at ?? "") > max ? r.ran_at ?? "" : max),
        runs[0]!.ran_at ?? "",
      );
      return { multi_agent_run_id, ran_at: ranAt, runs };
    },
  );
  return groups.sort((a, b) => (a.ran_at < b.ran_at ? 1 : a.ran_at > b.ran_at ? -1 : 0));
}
