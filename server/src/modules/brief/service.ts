import type { PrBriefReviewRollup, PrBriefSnapshot, RunSummary } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { ReviewRow } from '../reviews/repository.js';
import type { FindingRow } from '../../db/rows.js';
import { buildFindingsSummary } from '../pulls/findings-summary.js';

/**
 * Brief module — GET /pulls/:id/brief. First increment: a purely
 * deterministic review rollup for the top-of-Overview "PR Brief" card
 * (verdict/score/blockers/findings/cost/tokens). No LLM call here — Risk
 * Areas and the LLM-synthesized summary (via the `risk_brief` feature model)
 * land in a later increment; see `docs/2026-08-07-pr-brief-plan.md`.
 */

/** Sum of non-null values, or `null` when every value is null (never `0` for
 *  "no data" — matches `RunCostBadge`'s own "null renders '—', not '$0.00'"
 *  convention upstream). */
function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/**
 * Pure: given a PR's reviews (newest-first, as `reviewsForPull` already
 * returns them) and its run history, compute the deterministic rollup — no
 * I/O, fixture-testable (mirrors `blast/service.ts`'s `assembleBlastRadius`
 * placement/style).
 *
 * verdict/score/blockers/findings/summary come from the single most-
 * recently-created `kind==='review'` row — the same "latest wins" precedent
 * `PrMeta.score` already uses for the PR list (`pulls/routes.ts`'s "newest-
 * first, first-seen-wins"), NOT an aggregate across every agent that has
 * reviewed the PR. `verdict` is recomputed from that review's own gate-
 * correct blockers/findings count, never read from `reviews.verdict` (the
 * model's own self-report — see `reviewer-core/review/reduce.ts`).
 *
 * cost_usd/tokens_in/tokens_out are the deliberate exception: summed across
 * EVERY run ever for the PR, mirroring `PrMeta.cost_usd`'s existing "every
 * review pass, not just latest" semantics — a different row-set than
 * verdict/score/blockers/findings, on purpose.
 */
export function computeReviewRollup(
  reviews: { review: ReviewRow; findings: FindingRow[] }[],
  runs: RunSummary[],
): PrBriefReviewRollup | null {
  const cost_usd = sumNullable(runs.map((r) => r.cost_usd));
  const tokens_in = sumNullable(runs.map((r) => r.tokens_in));
  const tokens_out = sumNullable(runs.map((r) => r.tokens_out));

  const latest = reviews.find(({ review }) => review.kind === 'review');
  if (!latest) return null;

  const matchingRun = runs.find((r) => r.run_id === latest.review.runId);
  const blockers_count = matchingRun?.blockers ?? 0;
  // Same pure helper the PR list uses for its FINDINGS column, over this
  // same latest review's findings — guarantees the Brief card's severity
  // badges always match what the list already shows for this PR.
  const findings_summary = buildFindingsSummary(latest.findings);
  const totalFindings = latest.findings.length;
  const verdict = blockers_count > 0 ? 'request_changes' : totalFindings > 0 ? 'comment' : 'approve';

  return {
    verdict,
    score: latest.review.score ?? 0,
    findings_summary,
    blockers_count,
    summary: latest.review.summary,
    cost_usd,
    tokens_in,
    tokens_out,
  };
}

export class BriefService {
  constructor(private container: Container) {}

  async build(prId: string, workspaceId: string): Promise<PrBriefSnapshot> {
    const reviews = await this.container.reviewRepo.reviewsForPull(prId);
    const runs = await this.container.reviewRepo.listRunsForPull(workspaceId, prId);
    return { review_rollup: computeReviewRollup(reviews, runs) };
  }
}
