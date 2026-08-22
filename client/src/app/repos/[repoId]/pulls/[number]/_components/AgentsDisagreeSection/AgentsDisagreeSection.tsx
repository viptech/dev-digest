/* AgentsDisagreeSection — SPEC-07 T13 (G4). Read-only "where agents
   disagree" block, built from T14's findings-clusters response
   (`GET /pulls/:id/review-groups`): one row per cluster × agent-in-group,
   "did not flag"/"pending"/"failed" per AC-22/AC-23, and a "Show only
   conflicts" toggle (default OFF — same convention as `FindingsPanel.tsx`'s
   `hideLow`) hiding unanimous clusters (AC-24). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, SectionLabel, SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { FindingClusterDto } from "@/lib/hooks/reviews";
import { isUnanimous, rowsForCluster } from "./helpers";
import { s } from "./styles";
import type { RunSummary } from "@devdigest/shared";

interface AgentsDisagreeSectionProps {
  /** The current group's runs (`MultiAgentReviewTab`'s `activeGroup.runs`). */
  runs: RunSummary[];
  clusters: FindingClusterDto[];
  isLoading?: boolean;
}

function clusterKey(c: FindingClusterDto) {
  return `${c.file}:${c.start_line}-${c.end_line}`;
}

export function AgentsDisagreeSection({ runs, clusters, isLoading }: AgentsDisagreeSectionProps) {
  const t = useTranslations("prReview");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  const withRows = React.useMemo(
    () => clusters.map((cluster) => ({ cluster, rows: rowsForCluster(cluster, runs) })),
    [clusters, runs],
  );
  const shown = onlyConflicts ? withRows.filter(({ rows }) => !isUnanimous(rows)) : withRows;

  return (
    <section>
      <SectionLabel
        icon="Users"
        right={
          <div style={s.toggleGroup}>
            {t("agentsDisagree.showOnlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
          </div>
        }
      >
        {t("agentsDisagree.title")}
      </SectionLabel>

      {isLoading ? null : clusters.length === 0 ? (
        <EmptyState icon="Users" title={t("agentsDisagree.emptyTitle")} />
      ) : shown.length === 0 ? (
        <EmptyState icon="CheckCircle" title={t("agentsDisagree.noConflictsTitle")} />
      ) : (
        <div style={s.list}>
          {shown.map(({ cluster, rows }) => (
            <div key={clusterKey(cluster)} style={s.clusterCard}>
              <div className="mono" style={s.clusterHeader}>
                {cluster.file}:{cluster.start_line}
                {cluster.end_line !== cluster.start_line ? `-${cluster.end_line}` : ""}
              </div>
              {rows.map((row) => (
                <div key={row.runId} style={s.row}>
                  <span style={s.agentName}>{row.agentName ?? t("multiAgentReview.unknownAgent")}</span>
                  {row.kind === "flagged" ? (
                    // AC-20: every one of this agent's findings in the
                    // cluster, not just the first — usually one, occasionally
                    // more when two overlapping findings from the same
                    // review land in the same locus.
                    <div style={s.matchList}>
                      {row.matches.map((m, i) => (
                        <span key={i} style={s.matchItem}>
                          <SeverityBadge severity={m.severity as Severity} compact />
                          <span style={s.title}>{m.title}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={s.statusText}>
                      {row.kind === "not_flagged"
                        ? t("agentsDisagree.didNotFlag")
                        : t(`agentsDisagree.${row.kind}`)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
