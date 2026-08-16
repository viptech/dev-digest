import type { Brief, PrBriefReviewRollup, PrBriefSnapshot, RunSummary } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { ReviewRow, PullRow } from '../reviews/repository.js';
import type { FindingRow } from '../../db/rows.js';
import { buildFindingsSummary } from '../pulls/findings-summary.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { renderPrompt } from '../../platform/prompts.js';
import { assembleBriefInput, callBrief, type Logger } from './risk-brief.js';
import { groundRisks, groundReviewFocus } from './grounding.js';
import { BriefRepository } from './repository.js';

export type { Logger };

/**
 * Brief module — GET /pulls/:id/brief, POST /pulls/:id/brief (SPEC-04).
 * `review_rollup` is a purely deterministic rollup (verdict/score/blockers/
 * cost) — no LLM. `brief` is the LLM-synthesized what/why/risk_level/risks/
 * review_focus, cached in `pr_brief` and regenerated only via the explicit
 * `POST` (never auto-generated on `GET`, AC-8/AC-9).
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
  private briefRepo: BriefRepository;

  constructor(private container: Container) {
    this.briefRepo = new BriefRepository(container.db);
  }

  private async getRollup(prId: string, workspaceId: string): Promise<PrBriefReviewRollup | null> {
    const reviews = await this.container.reviewRepo.reviewsForPull(prId);
    const runs = await this.container.reviewRepo.listRunsForPull(workspaceId, prId);
    return computeReviewRollup(reviews, runs);
  }

  /**
   * `GET /pulls/:id/brief` — reads ONLY the cached `pr_brief` row, no LLM
   * call. `brief` is `null` when no row exists yet OR the cached `headSha`
   * no longer matches the PR's current `head_sha` (AC-8's staleness rule —
   * a stale cache reads as absent, it is not auto-regenerated here).
   */
  async build(pull: PullRow, workspaceId: string): Promise<PrBriefSnapshot> {
    const review_rollup = await this.getRollup(pull.id, workspaceId);
    const row = await this.briefRepo.getByPrId(pull.id);
    const fresh = row !== undefined && row.headSha === pull.headSha;
    return {
      review_rollup,
      brief: fresh ? (row!.json as Brief) : null,
      brief_generated_at: fresh ? row!.createdAt.toISOString() : null,
    };
  }

  /**
   * `POST /pulls/:id/brief` (AC-9) — ALWAYS performs the full generation
   * pipeline (AC-1–AC-7), never an internal cache short-circuit (mirrors
   * `onboarding.generate`'s "always runs" contract). Workspace/PR ownership
   * is already enforced by `routes.ts`'s inline select BEFORE this method is
   * ever called (AC-12) — unlike onboarding, brief's existing `GET` already
   * puts that check in `routes.ts`, not `service.ts`, so `generate` follows
   * the SAME existing convention rather than introducing a second,
   * service-level check.
   *
   * A degraded (LLM call failed) result is returned TRANSIENTLY and is
   * NEVER persisted (AC-13) — `briefRepo.upsert` is only reached on the
   * non-degraded success path below.
   */
  async generate(
    pull: PullRow,
    repoRow: { id: string; owner: string; name: string },
    workspaceId: string,
    logger?: Logger,
  ): Promise<PrBriefSnapshot> {
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    // Rendered ONCE here — the ONE rendering call for this whole invocation,
    // threaded into both `assembleBriefInput`'s budget check (AC-2) and
    // `callBrief`'s actual send (cross-model review finding B5).
    const systemPromptTemplate = await renderPrompt('risk-brief.system.md', {});

    const inputs = await assembleBriefInput(this.container, pull, repoRow, systemPromptTemplate, logger);

    let result: Awaited<ReturnType<typeof callBrief>>;
    try {
      result = await callBrief(this.container, {
        provider,
        model,
        systemPrompt: systemPromptTemplate,
        userMessage: inputs.userMessage,
      });
    } catch (err) {
      logger?.warn(
        { prId: pull.id, call: 'brief.generate', model, err: err instanceof Error ? err.message : String(err) },
        'brief.generate: LLM call failed, returning degraded result',
      );
      return {
        review_rollup: await this.getRollup(pull.id, workspaceId),
        brief: null,
        brief_generated_at: null,
        brief_degraded: true,
      };
    }

    // AC-5, AC-6, AC-7 — grounding strictly after the call, strictly before
    // persistence.
    const groundedRisks = groundRisks(result.data.risks, inputs.knownFileRefsUniverse);
    const groundedFocus = groundReviewFocus(result.data.review_focus, inputs.changedPaths);
    const brief: Brief = { ...result.data, risks: groundedRisks, review_focus: groundedFocus };

    // AC-14 — structured cost log line. NEVER logs `brief.what`/`why`/
    // `risks`/`review_focus` prose.
    const costUsd = result.costUsd;
    logger?.info(
      { prId: pull.id, call: 'brief.generate', model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd },
      'brief.generate: prompt assembled',
    );

    // ONE timestamp, reused for both the persisted row and the returned
    // snapshot (cross-model review finding B4 follow-through — an earlier
    // draft computed `new Date()` twice, independently, so the persisted
    // `createdAt` and the returned `brief_generated_at` could disagree).
    const generatedAt = new Date();
    await this.briefRepo.upsert(pull.id, {
      json: brief,
      providerUsed: provider,
      modelUsed: model,
      headSha: pull.headSha,
      createdAt: generatedAt,
    });

    return {
      review_rollup: await this.getRollup(pull.id, workspaceId),
      brief,
      brief_generated_at: generatedAt.toISOString(),
    };
  }
}
