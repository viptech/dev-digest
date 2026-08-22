/* Pure helpers for AgentsDisagreeSection (SPEC-07 T13, AC-21..24) — no DB/fs/
   network, so they're trivially unit-testable on their own. */
import type { FindingClusterDto } from "@/lib/hooks/reviews";
import type { RunSummary } from "@devdigest/shared";

export type ClusterRowKind = "flagged" | "not_flagged" | "pending" | "failed";

export interface ClusterRow {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  kind: ClusterRowKind;
  severity?: string;
  title?: string;
}

/**
 * One row per agent (run) in the group, for one cluster (AC-22/AC-23):
 * - `running` → "pending" (not "did not flag" — the agent hasn't finished).
 * - `failed`/`cancelled` → "failed" (same reasoning).
 * - `done` with a matching finding (by `agentId`) in the cluster → "flagged",
 *   carrying that finding's severity + title.
 * - `done` with none → "not_flagged" ("did not flag", literally, per AC-22).
 *
 * A `done` agent could in principle have more than one finding of its own
 * inside the same cluster (two overlapping findings from the same review);
 * the first is used for display/conflict purposes, since a cluster is a
 * small code locus and this is a rare, non-adversarial edge case.
 */
export function rowsForCluster(cluster: FindingClusterDto, runs: RunSummary[]): ClusterRow[] {
  return runs.map((run) => {
    if (run.status === "running") {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "pending" };
    }
    if (run.status === "failed" || run.status === "cancelled") {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "failed" };
    }
    const match = cluster.findings.find((cf) => cf.agent_id === run.agent_id);
    if (!match) {
      return { runId: run.run_id, agentId: run.agent_id, agentName: run.agent_name, kind: "not_flagged" };
    }
    return {
      runId: run.run_id,
      agentId: run.agent_id,
      agentName: run.agent_name,
      kind: "flagged",
      severity: match.finding.severity,
      title: match.finding.title,
    };
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
  const signature = new Set(settled.map((r) => (r.kind === "flagged" ? `sev:${r.severity}` : "not_flagged")));
  return signature.size <= 1;
}
