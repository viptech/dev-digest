"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Badge } from "@devdigest/ui";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ApiError } from "@/lib/api";
import { METRIC_COLOR } from "@/lib/eval-metrics";
import type { VersionedRunGroup } from "@/lib/eval-runs";
import { computeMetricDeltas, averageCost, diffPromptLines } from "./helpers";
import { s } from "./styles";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Compare-runs modal (SPEC-05 T15): metric deltas (recall/precision/
 * citation_accuracy/cost) + a naive line-level `system_prompt_snapshot`
 * diff between two set-runs, plus a "Promote v{N}" button per side.
 *
 * "Promote" is NOT a new versioning concept (explicit non-goal) — it's a
 * direct write of `run.system_prompt_snapshot` back onto the live agent via
 * the EXISTING `useUpdateAgent()`/`PUT /agents/:id` path, i.e. "roll back to
 * a known-good prompt". No new server route.
 */
export function CompareRunsModal({
  agentId,
  older,
  newer,
  onClose,
}: {
  agentId: string;
  older: VersionedRunGroup;
  newer: VersionedRunGroup;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const update = useUpdateAgent();
  const [promoteError, setPromoteError] = React.useState<string | null>(null);
  const [promotedVersion, setPromotedVersion] = React.useState<number | null>(null);

  const deltas = computeMetricDeltas(older, newer);
  const oldCost = averageCost(older);
  const newCost = averageCost(newer);

  const bothCaptured = older.systemPromptSnapshot != null && newer.systemPromptSnapshot != null;
  const diffLines = bothCaptured ? diffPromptLines(older.systemPromptSnapshot, newer.systemPromptSnapshot) : [];

  const onPromote = async (group: VersionedRunGroup) => {
    setPromoteError(null);
    setPromotedVersion(null);
    if (group.systemPromptSnapshot == null) return;
    try {
      await update.mutateAsync({ id: agentId, patch: { system_prompt: group.systemPromptSnapshot } });
      setPromotedVersion(group.version);
    } catch (e) {
      setPromoteError(e instanceof ApiError ? e.message : t("compareModal.promoteFailed"));
    }
  };

  return (
    <Modal
      width={760}
      title={t("compareModal.heading")}
      onClose={onClose}
      footer={
        <div style={s.promoteRow}>
          {promoteError && <div style={s.errorNotice}>{promoteError}</div>}
          {promotedVersion != null && <Badge color="var(--ok)">{t("compareModal.promoteSuccess")}</Badge>}
          <Button
            kind="secondary"
            size="sm"
            disabled={update.isPending || older.systemPromptSnapshot == null}
            onClick={() => onPromote(older)}
          >
            {update.isPending ? t("compareModal.promoting") : t("compareModal.promote", { version: older.version })}
          </Button>
          <Button
            kind="primary"
            size="sm"
            disabled={update.isPending || newer.systemPromptSnapshot == null}
            onClick={() => onPromote(newer)}
          >
            {update.isPending ? t("compareModal.promoting") : t("compareModal.promote", { version: newer.version })}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <h3 style={s.sectionHeading}>{t("compareModal.metricsHeading")}</h3>
        {deltas.map((d) => (
          <div key={d.key} style={s.metricRow}>
            <span style={s.metricLabel}>{d.key.replace("_", " ")}</span>
            <span>{pct(d.older)}</span>
            <span>→</span>
            <span style={{ color: METRIC_COLOR[d.key] }}>{pct(d.newer)}</span>
            <span style={s.delta(d.delta >= 0)}>
              {d.delta >= 0 ? "▲" : "▼"} {pct(Math.abs(d.delta))}
            </span>
          </div>
        ))}
        <div style={s.metricRow}>
          <span style={s.metricLabel}>{t("compareModal.cost")}</span>
          <span>{oldCost != null ? `$${oldCost.toFixed(2)}` : "—"}</span>
          <span>→</span>
          <span>{newCost != null ? `$${newCost.toFixed(2)}` : "—"}</span>
          <span />
        </div>

        <h3 style={s.sectionHeading}>{t("compareModal.promptDiffHeading")}</h3>
        {!bothCaptured ? (
          <>
            {older.systemPromptSnapshot == null && (
              <p style={s.muted}>
                v{older.version}: {t("compareModal.promptNotCaptured")}
              </p>
            )}
            {newer.systemPromptSnapshot == null && (
              <p style={s.muted}>
                v{newer.version}: {t("compareModal.promptNotCaptured")}
              </p>
            )}
            {(older.systemPromptSnapshot ?? newer.systemPromptSnapshot) != null && (
              <pre style={s.diffBox}>{older.systemPromptSnapshot ?? newer.systemPromptSnapshot}</pre>
            )}
          </>
        ) : (
          <div style={s.diffBox}>
            {diffLines.map((line, i) => (
              <div key={i} style={s.diffLine(line.status)}>
                {line.status === "removed" ? "- " : line.status === "added" ? "+ " : "  "}
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
