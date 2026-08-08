import { describe, it, expect } from 'vitest';
import { computeReviewRollup } from './service.js';
import type { ReviewRow } from '../reviews/repository.js';
import type { FindingRow } from '../../db/rows.js';
import type { RunSummary } from '@devdigest/shared';

/**
 * Pure-function unit tests for `computeReviewRollup` — no I/O, mirrors
 * `blast/service.test.ts`'s placement convention (co-located with the
 * module, not in top-level `server/test/`).
 */

function reviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: 'review-1',
    workspaceId: 'ws-1',
    prId: 'pr-1',
    agentId: 'agent-1',
    runId: 'run-1',
    kind: 'review',
    verdict: 'approve', // the model's self-report — deliberately ignored by computeReviewRollup
    summary: 'Looks solid overall.',
    score: 88,
    model: 'gpt-4.1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function findingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    file: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    severity: 'WARNING',
    category: 'correctness',
    title: 'Something',
    rationale: 'Because',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    provider: 'openrouter',
    model: 'gpt-4.1',
    status: 'done',
    error: null,
    duration_ms: 1000,
    tokens_in: 1000,
    tokens_out: 200,
    cost_usd: 0.01,
    findings_count: 1,
    grounding: 'ok',
    ran_at: '2026-08-01T00:00:00Z',
    score: 88,
    blockers: 0,
    ...overrides,
  };
}

describe('computeReviewRollup', () => {
  it('returns null when the PR has never been reviewed', () => {
    expect(computeReviewRollup([], [])).toBeNull();
  });

  it('uses the single latest review (first in the newest-first array), not an aggregate across agents', () => {
    const older = { review: reviewRow({ id: 'review-old', score: 10, createdAt: new Date('2026-07-01') }), findings: [] };
    const latest = { review: reviewRow({ id: 'review-new', score: 90 }), findings: [] };
    // reviewsForPull already orders newest-first — latest is index 0.
    const result = computeReviewRollup([latest, older], []);
    expect(result!.score).toBe(90);
  });

  it('skips a kind="summary" row and picks the first kind="review" row', () => {
    const summaryRow = { review: reviewRow({ id: 'summary-1', kind: 'summary', score: null }), findings: [] };
    const reviewRowEntry = { review: reviewRow({ id: 'review-1', score: 70 }), findings: [] };
    const result = computeReviewRollup([summaryRow, reviewRowEntry], []);
    expect(result!.score).toBe(70);
  });

  it('never reads reviews.verdict (the model self-report) — recomputes deterministically from blockers/findings', () => {
    // verdict:'approve' on the row itself, but 2 blockers persisted on the run — must still surface as request_changes.
    const review = { review: reviewRow({ verdict: 'approve' }), findings: [findingRow(), findingRow({ id: 'f2' })] };
    const runs = [runSummary({ blockers: 2 })];
    const result = computeReviewRollup([review], runs);
    expect(result!.verdict).toBe('request_changes');
  });

  it('verdict falls back to comment when there are findings but zero blockers, and approve when there are none', () => {
    const withFindings = computeReviewRollup(
      [{ review: reviewRow(), findings: [findingRow()] }],
      [runSummary({ blockers: 0 })],
    );
    expect(withFindings!.verdict).toBe('comment');

    const clean = computeReviewRollup([{ review: reviewRow(), findings: [] }], [runSummary({ blockers: 0 })]);
    expect(clean!.verdict).toBe('approve');
  });

  it('blockers_count is 0 when no matching agent_runs row is found for the review\'s run_id', () => {
    const result = computeReviewRollup([{ review: reviewRow({ runId: 'run-missing' }), findings: [] }], [
      runSummary({ run_id: 'run-1', blockers: 5 }),
    ]);
    expect(result!.blockers_count).toBe(0);
  });

  it('findings_summary is built from this review\'s own findings (same buildFindingsSummary the PR list uses), not agent_runs.findings_count', () => {
    const result = computeReviewRollup(
      [
        {
          review: reviewRow(),
          findings: [
            findingRow({ id: 'f1', severity: 'CRITICAL' }),
            findingRow({ id: 'f2', severity: 'WARNING' }),
            findingRow({ id: 'f3', severity: 'WARNING' }),
          ],
        },
      ],
      [runSummary({ findings_count: 99 })],
    );
    expect(result!.findings_summary.counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(result!.findings_summary.items).toHaveLength(3);
  });

  it('summary is this review\'s own prose summary, verbatim', () => {
    const result = computeReviewRollup(
      [{ review: reviewRow({ summary: 'A Stripe secret key is committed in plaintext.' }), findings: [] }],
      [],
    );
    expect(result!.summary).toBe('A Stripe secret key is committed in plaintext.');
  });

  it('cost/tokens sum across EVERY run ever for the PR — a different row-set than the latest-review verdict/score', () => {
    // Two runs (e.g. an agent re-run once): cost/tokens sum both, but the
    // review rollup (verdict/score/blockers) only reflects the latest review.
    const runs = [
      runSummary({ run_id: 'run-1', cost_usd: 0.01, tokens_in: 1000, tokens_out: 200 }),
      runSummary({ run_id: 'run-2', cost_usd: 0.02, tokens_in: 2000, tokens_out: 300 }),
    ];
    const result = computeReviewRollup([{ review: reviewRow({ runId: 'run-2' }), findings: [] }], runs);
    expect(result!.cost_usd).toBeCloseTo(0.03);
    expect(result!.tokens_in).toBe(3000);
    expect(result!.tokens_out).toBe(500);
  });

  it('cost/tokens are null (not 0) when every run has null cost/tokens', () => {
    const result = computeReviewRollup(
      [{ review: reviewRow(), findings: [] }],
      [runSummary({ cost_usd: null, tokens_in: null, tokens_out: null })],
    );
    expect(result!.cost_usd).toBeNull();
    expect(result!.tokens_in).toBeNull();
    expect(result!.tokens_out).toBeNull();
  });

  it('zero reviews returns null for the whole rollup, regardless of run history', () => {
    const result = computeReviewRollup([], [runSummary({ cost_usd: 5 })]);
    expect(result).toBeNull();
  });
});
