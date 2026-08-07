/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, Chip, EmptyState, SEV, type Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { severityCounts } from "@/lib/findings";
import { KEY_TO_ACTION, SEVERITY_ORDER } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

const SEVERITY_CHIPS: Severity[] = (["CRITICAL", "WARNING", "SUGGESTION"] as const)
  .slice()
  .sort((a, b) => SEVERITY_ORDER[a]! - SEVERITY_ORDER[b]!);

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
  targetFindingNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Jump target from outside (a Smart Diff finding badge) — this finding's
   *  card force-expands + scrolls into view once it's rendered. */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const [activeSeverities, setActiveSeverities] = React.useState<Set<Severity>>(new Set());

  // A jump target must be visible regardless of whatever filter was active —
  // clear them so the targeted card is guaranteed to render.
  React.useEffect(() => {
    if (targetFindingId) {
      setHideLow(false);
      setActiveSeverities(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingId, targetFindingNonce]);

  const counts = React.useMemo(() => severityCounts(findings), [findings]);
  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, activeSeverities),
    [findings, hideLow, activeSeverities],
  );

  const toggleSeverity = (sev: Severity) => {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.severityChips}>
          {SEVERITY_CHIPS.map((sev) => (
            <Chip
              key={sev}
              active={activeSeverities.has(sev)}
              count={counts[sev] ?? 0}
              color={SEV[sev].c}
              icon={SEV[sev].icon}
              onClick={() => toggleSeverity(sev)}
            >
              {sev}
            </Chip>
          ))}
        </div>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              forceFocus={f.id === targetFindingId}
              focusNonce={targetFindingNonce}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
