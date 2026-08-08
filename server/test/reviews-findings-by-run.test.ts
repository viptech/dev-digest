import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import * as t from '../src/db/schema.js';
import type { AuthProvider } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';

/**
 * `GET /runs/:id/findings` — the additive read behind MCP's
 * `get_findings(run_id)`: `reviews.run_id` is populated independently of
 * `pr_id`/`agent_runs`, so a review can be resolved from a bare run_id with
 * no join through the pull. Covers (a) a persisted review → 200 with
 * findings, (b) no review for that run_id → 404 (same as "still running" or
 * "run_id doesn't exist" — the route can't tell those apart, by design).
 *
 * No Postgres needed: `auth` is overridden so `getContext()` never touches
 * the DB, and a minimal fake `Db` stands in for the two query shapes
 * `getReviewByRunId` issues (see fakeDb below) — same "stub the outside
 * world, not the object under test" spirit as
 * conventions-file-guard.test.ts, just one layer lower (DB instead of repo)
 * so the route's NotFoundError → 404 mapping is exercised for real.
 */

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const auth: AuthProvider = {
  currentUser: async () => ({ id: 'u1', email: 'u@example.com', name: 'U' }),
  currentWorkspace: async () => ({ id: 'ws1', name: 'ws' }),
};

type ReviewRow = typeof t.reviews.$inferSelect;
type FindingRow = typeof t.findings.$inferSelect;

/**
 * Fake `Db` supporting exactly the two shapes `getReviewByRunId` issues:
 * `select().from(reviews).where(...).limit(1)` then, if a review was found,
 * `select().from(findings).where(...)`. Anything else (e.g. the boot-time
 * `reapStaleRunningRuns` UPDATE `buildApp` runs before listening) is allowed
 * to throw — `app.ts` already catches that as non-fatal.
 */
function fakeDb(scenario: { review?: ReviewRow; findings?: FindingRow[] }): Db {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === t.reviews) {
          return {
            where: () => ({
              limit: async () => (scenario.review ? [scenario.review] : []),
            }),
          };
        }
        if (table === t.findings) {
          return { where: async () => scenario.findings ?? [] };
        }
        throw new Error('fakeDb: unexpected table in select().from()');
      },
    }),
  } as unknown as Db;
}

// IdParams (params: { id: z.string().uuid() }) validates the route param, so
// every id used here (including the "unknown" one) must be UUID-shaped.
const REVIEW_ID = '11111111-1111-1111-1111-111111111111';
const PR_ID = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-3333-3333-333333333333';
const UNKNOWN_RUN_ID = '99999999-9999-9999-9999-999999999999';
const FINDING_ID = '44444444-4444-4444-4444-444444444444';

const REVIEW: ReviewRow = {
  id: REVIEW_ID,
  workspaceId: 'ws1',
  prId: PR_ID,
  agentId: null,
  runId: RUN_ID,
  kind: 'review',
  verdict: 'request_changes',
  summary: 'Found one issue.',
  score: 80,
  model: 'gpt-4.1',
  createdAt: new Date('2026-08-06T00:00:00Z'),
};

const FINDING: FindingRow = {
  id: FINDING_ID,
  reviewId: REVIEW_ID,
  file: 'src/config.ts',
  startLine: 11,
  endLine: 11,
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded secret',
  rationale: 'A live key is committed in source.',
  suggestion: null,
  confidence: 0.95,
  kind: 'finding',
  trifectaComponents: null,
  acceptedAt: null,
  dismissedAt: null,
};

describe('GET /runs/:id/findings', () => {
  it('returns 200 with the review + findings for a run_id that has a persisted review', async () => {
    const app = await buildApp({
      config,
      db: fakeDb({ review: REVIEW, findings: [FINDING] }),
      overrides: { auth },
    });

    const res = await app.inject({ method: 'GET', url: `/runs/${REVIEW.runId}/findings` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(REVIEW.id);
    expect(body.run_id).toBe(REVIEW.runId);
    expect(body.verdict).toBe('request_changes');
    expect(body.score).toBe(80);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].file).toBe('src/config.ts');
    expect(body.findings[0].start_line).toBe(11);
    expect(body.findings[0].severity).toBe('CRITICAL');

    await app.close();
  });

  it('returns 404 when no review was persisted for that run_id', async () => {
    const app = await buildApp({
      config,
      db: fakeDb({}),
      overrides: { auth },
    });

    const res = await app.inject({ method: 'GET', url: `/runs/${UNKNOWN_RUN_ID}/findings` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toMatch(/not found/i);

    await app.close();
  });
});
