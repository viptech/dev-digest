"use client";

import React from "react";
import { Badge, Button, Icon, SectionLabel } from "@devdigest/ui";
import { useBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { notify } from "@/lib/toast";
import type { Brief, RiskLevel } from "@devdigest/shared";
import { VerdictBanner } from "../../../VerdictBanner";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null | undefined;
}

/** `risk_level` badge colors — same three CSS variables
 *  `IntentAndRiskCard`'s severity-colored risk chips use (SPEC-04 Step 9). */
const RISK_LEVEL_COLOR: Record<RiskLevel, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--info)", bg: "var(--info-bg)" },
};

/**
 * The Why+Risk half of the PR Brief card (SPEC-04). Four states, driven by
 * `brief`/`degraded` alone — independent of whether `review_rollup` exists:
 *  - empty: no brief generated yet → "No brief yet" + Generate CTA.
 *  - populated: a fresh, non-degraded `brief` → risk-level badge + what/why
 *    prose + Regenerate.
 *  - degraded, brief present: a Regenerate attempt just failed but a
 *    previously-good brief is still cached (`useGenerateBrief`'s M3 merge,
 *    hooks/brief.ts) → same populated content plus an inline notice.
 *  - degraded, no brief: the first-ever generation attempt failed, nothing
 *    to fall back to → retry message + the same Generate CTA.
 */
function WhyRiskSection({ prId, brief, degraded }: { prId: string | null | undefined; brief: Brief | null; degraded: boolean }) {
  const generate = useGenerateBrief(prId);

  const handleGenerate = () => {
    generate.mutate(undefined, {
      onError: (err) => notify.error((err as Error).message),
    });
  };

  const buttonLabel = generate.isPending ? "Generating…" : brief ? "Regenerate" : "Generate brief";

  if (!brief) {
    return (
      <div style={s.briefCard}>
        <p style={s.emptyText}>
          {degraded ? "Couldn't generate a brief right now." : "No brief yet."}
        </p>
        <Button kind="secondary" size="sm" icon="Sparkles" loading={generate.isPending} onClick={handleGenerate}>
          {buttonLabel}
        </Button>
      </div>
    );
  }

  const level = RISK_LEVEL_COLOR[brief.risk_level];

  return (
    <div style={s.briefCard}>
      <div style={s.headerRow}>
        <Badge color={level.color} bg={level.bg}>
          {brief.risk_level} risk
        </Badge>
        <Button kind="ghost" size="sm" icon="RefreshCw" loading={generate.isPending} onClick={handleGenerate}>
          {buttonLabel}
        </Button>
      </div>
      {degraded && (
        <div role="status" style={s.degradedNotice}>
          <Icon.AlertTriangle size={13} />
          <span>Couldn&apos;t refresh — showing the last generated brief.</span>
        </div>
      )}
      <p style={s.prose}>{brief.what}</p>
      <p style={s.prose}>{brief.why}</p>
    </div>
  );
}

/**
 * Top-of-Overview "PR Brief" card. Two independent halves:
 *  - `VerdictBanner`, fed the deterministic verdict/score/blockers/cost
 *    rollup from the PR's latest review — rendered only when at least one
 *    review exists (`review_rollup` present).
 *  - the Why+Risk section (SPEC-04), rendered UNCONDITIONALLY regardless of
 *    `review_rollup` — a PR with zero reviews can, and must, still support
 *    brief generation (spec's own Edge cases: "рев'ю не є передумовою
 *    генерації брифу"). The early `if (!rollup) return null` this card used
 *    to have made the Why+Risk section permanently unreachable for exactly
 *    that case (cross-model review finding B1) — removed here.
 *
 * Renders nothing only while the underlying query genuinely has no data yet
 * (first load) — once `useBrief` resolves (even to an all-null snapshot),
 * the section body always renders.
 */
export function PrBriefCard({ prId }: PrBriefCardProps) {
  const { data } = useBrief(prId);
  if (!data) return null;

  const { review_rollup: rollup, brief, brief_degraded } = data;

  return (
    <section>
      <SectionLabel icon="FileText">PR Brief</SectionLabel>
      {rollup && (
        <VerdictBanner
          verdict={rollup.verdict}
          summary={rollup.summary}
          score={rollup.score}
          findingsCount={rollup.findings_summary.counts.CRITICAL + rollup.findings_summary.counts.WARNING + rollup.findings_summary.counts.SUGGESTION}
          blockers={rollup.blockers_count}
          findingsSummary={rollup.findings_summary}
          cost={{ costUsd: rollup.cost_usd, tokensIn: rollup.tokens_in, tokensOut: rollup.tokens_out }}
          groupScoreWithCost
        />
      )}
      <WhyRiskSection prId={prId} brief={brief} degraded={!!brief_degraded} />
    </section>
  );
}
