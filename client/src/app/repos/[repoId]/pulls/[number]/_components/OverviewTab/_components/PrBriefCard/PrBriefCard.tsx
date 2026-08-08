"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { useBrief } from "@/lib/hooks/brief";
import { VerdictBanner } from "../../../VerdictBanner";

interface PrBriefCardProps {
  prId: string | null | undefined;
}

/**
 * Top-of-Overview "PR Brief" card. First increment: a purely deterministic
 * verdict/score/blockers/findings/cost/tokens rollup from the PR's latest
 * review (no LLM call yet — see docs/2026-08-07-pr-brief-plan.md for the
 * later Risk Areas / prior-PRs increments).
 *
 * Deliberately reuses `VerdictBanner` wholesale rather than re-composing the
 * same verdict badge + score gauge + cost/token line + prose summary from
 * scratch — that component already renders exactly this shape (bordered
 * card, icon+label, findings/blockers badge, summary paragraph, cost row,
 * CircularScore gauge) for a single review run; here it's fed the PR-level
 * rollup instead of one run's data.
 *
 * Renders nothing until the PR has at least one review, matching
 * `BlastRadiusCard`'s own established "nothing to show yet" convention.
 */
export function PrBriefCard({ prId }: PrBriefCardProps) {
  const { data: brief } = useBrief(prId);
  const rollup = brief?.review_rollup;
  if (!rollup) return null;

  return (
    <section>
      <SectionLabel icon="FileText">PR Brief</SectionLabel>
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
    </section>
  );
}
