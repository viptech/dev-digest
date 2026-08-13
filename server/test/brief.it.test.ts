/**
 * `pr_brief` — end-to-end through real Postgres. Docker-gated, self-skips
 * without it (`dockerAvailable()`, same pattern `blast.it.test.ts` uses).
 *
 * THIS FILE IS DELIBERATELY MINIMAL for now (SPEC-04 commit "Code — server
 * foundation", T1/T2/T3 only): it covers ONLY T2's migration column
 * round-trip — a raw insert/select against the `pr_brief` table via Drizzle
 * directly, NOT through `BriefRepository` (that class doesn't exist yet —
 * it lands in a later commit, Step 5 of
 * `.claude/plans/spec-04-pr-why-risk-brief.md`). Later commits (T5's
 * `BriefRepository`/`BriefService.generate`, T6's `POST /pulls/:id/brief`
 * route) EXTEND this same file with the cache-hit/staleness/cross-workspace/
 * rate-limit cases the plan's Test plan section describes — this commit's
 * job is only to prove the four new columns
 * (`provider_used`/`model_used`/`head_sha`/`created_at`) actually exist and
 * round-trip after `pnpm db:generate` + migrate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { Brief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('pr_brief table (Testcontainers pg) — SPEC-04 T2 column round-trip', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('provider_used/model_used/head_sha round-trip; created_at is populated by the column default', async () => {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'brief-t2', fullName: 'acme/brief-t2' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'cafefeed',
        additions: 5,
        deletions: 1,
        filesCount: 1,
        status: 'open',
      })
      .returning();

    const brief: Brief = {
      what: 'Adds rate limiting to the public API.',
      why: 'Prevents abuse of the unauthenticated webhook receiver.',
      risk_level: 'medium',
      risks: [],
      review_focus: [],
    };

    const before = new Date();
    await pg.handle.db.insert(t.prBrief).values({
      prId: pr!.id,
      json: brief,
      providerUsed: 'openai',
      modelUsed: 'gpt-4.1',
      headSha: pr!.headSha,
      // createdAt intentionally OMITTED — must come from the column's own
      // `.defaultNow()`, not a value this test passes explicitly.
    });

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr!.id));
    expect(row).toBeDefined();
    expect(row!.providerUsed).toBe('openai');
    expect(row!.modelUsed).toBe('gpt-4.1');
    expect(row!.headSha).toBe('cafefeed');
    expect(row!.json).toEqual(brief);
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});
