/* Pure helpers for AgentsDisagreeSection (SPEC-07 T13, AC-21..24) — no DB/fs/
   network, so they're trivially unit-testable on their own. */
import type { FindingClusterDto } from "@/lib/hooks/reviews";
import type { RunSummary } from "@devdigest/shared";

export type ClusterRowKind = "flagged" | "not_flagged" | "pending" | "failed";

export interface ClusterRowMatch {
  severity: string;
  title: string;
}

export interface ClusterRow {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  kind: ClusterRowKind;
  /** Every one of this agent's findings that landed in this cluster
   *  (AC-20: "показувати ВСІ знахідки кластера... не втрачаючи оригіналів" —
   *  a `done` agent can have more than one overlapping finding in the same
   *  small code locus; all of them are kept, not just the first). Empty for
   *  non-"flagged" kinds. */
  matches: ClusterRowMatch[];
}

/**
 * One row per agent (run) in the group, for one cluster (AC-22/AC-23):
 * - `running` → "pending" (not "did not flag" — the agent hasn't finished).
 * - `failed`/`cancelled` → "failed" (same reasoning).
 * - `done` with matching finding(s) (by `agentId`) in the cluster →
 *   "flagged", carrying EVERY matching finding's severity + title (AC-20).
 * - `done` with none → "not_flagged" ("did not flag", literally, per AC-22).
 */
export function rowsForCluster(cluster: FindingClusterDto, runs: RunSummary[]): ClusterRow[] {
  return runs.map((run) => {
    if (run.status === "running") {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "pending", matches: [] };
    }
    if (run.status === "failed" || run.status === "cancelled") {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "failed", matches: [] };
    }
    const matches = cluster.findings
      .filter((cf) => cf.agent_id === run.agent_id)
      .map((cf) => ({ severity: cf.finding.severity, title: cf.finding.title }));
    if (matches.length === 0) {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "not_flagged", matches: [] };
    }
    return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "flagged", matches };
  });
}

/**
 * AC-24: a cluster is unanimous when every present `done` agent agrees —
 * either all flagged with the SAME severity, or all "did not flag". A
 * cluster with exactly one (or zero) `done` agent counts as unanimous too
 * (nothing to disagree about) — `running`/`failed` rows never affect this,
 * since AC-23 already keeps them out of the "did not flag" bucket.
 */
export function isUnanimous(rows: ClusterRow[]): boolean {
  const settled = rows.filter((r) => r.kind === "flagged" || r.kind === "not_flagged");
  const signature = new Set(
    settled.map((r) =>
      r.kind === "flagged"
        ? `sev:${r.matches
            .map((m) => m.severity)
            .sort()
            .join(",")}`
        : "not_flagged",
    ),
  );
  return signature.size <= 1;
}
