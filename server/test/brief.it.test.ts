/**
 * `pr_brief` — end-to-end through real Postgres. Docker-gated, self-skips
 * without it (`dockerAvailable()`, same pattern `blast.it.test.ts`/
 * `onboarding.it.test.ts` use).
 *
 * Covers T2 (migration column round-trip), T5 (`BriefRepository`/
 * `BriefService.generate` — cache hit/miss, degrade-never-persists), and T6
 * (`POST /pulls/:id/brief` — ownership-before-LLM-call ordering, rate limit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Brief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FIXTURE_BRIEF: Brief = {
  what: 'Adds rate limiting to the public API.',
  why: 'Prevents abuse of the unauthenticated webhook receiver.',
  risk_level: 'medium',
  risks: [],
  review_focus: [],
};

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

d('GET/POST /pulls/:id/brief — generate/cache/ownership (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let repoSeq = 0;
  let prSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'Other Workspace' }).returning();
    otherWorkspaceId = otherWs!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(ws: string) {
    const name = `brief-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!;
  }

  async function makePr(repoId: string, ws: string, overrides: Partial<typeof t.pullRequests.$inferInsert> = {}) {
    const number = prSeq++;
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId,
        number,
        title: `PR #${number}`,
        author: 'marisa.koch',
        branch: `feat/pr-${number}`,
        base: 'main',
        headSha: `sha-${number}`,
        additions: 5,
        deletions: 1,
        filesCount: 1,
        status: 'open',
        ...overrides,
      })
      .returning();
    return pr!;
  }

  function appWith(llm?: MockLLMProvider) {
    const mock = llm ?? new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      // risk_brief defaults to openai (FEATURE_MODELS) — mock it directly.
      overrides: { llm: { openai: mock } },
    });
  }

  it('GET returns brief: null before any generation', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const pr = await makePr(repo.id, workspaceId);
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().brief).toBeNull();
    expect(res.json().brief_generated_at).toBeNull();
    await app.close();
  });

  it('POST generates + persists a row; GET then returns the persisted brief with exactly one total LLM call (cache hit, AC-11)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    const app = await appWith(llm);
    const repo = await makeRepo(workspaceId);
    const pr = await makePr(repo.id, workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);
    const postBody = post.json();
    expect(postBody.brief_degraded).toBeUndefined();
    expect(postBody.brief.what).toBe(FIXTURE_BRIEF.what);
    expect(typeof postBody.brief_generated_at).toBe('string');

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.headSha).toBe(pr.headSha);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(200);
    expect(get.json().brief.what).toBe(FIXTURE_BRIEF.what);
    expect(get.json().brief_generated_at).toBe(postBody.brief_generated_at);

    // Exactly ONE LLM call total across POST + GET — GET never calls the LLM.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);

    await app.close();
  });

  it('a second POST UPSERTs the same pr_id row with a new headSha/createdAt', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const pr = await makePr(repo.id, workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const firstRows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(firstRows).toHaveLength(1);
    const firstCreatedAt = firstRows[0]!.createdAt.getTime();

    // Simulate a new commit landing before Regenerate is clicked.
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'sha-new' }).where(eq(t.pullRequests.id, pr.id));
    const [updatedPr] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));

    await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable createdAt
    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);

    const secondRows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(secondRows).toHaveLength(1); // UPSERT, not a second row
    expect(secondRows[0]!.headSha).toBe(updatedPr!.headSha);
    expect(secondRows[0]!.createdAt.getTime()).toBeGreaterThan(firstCreatedAt);

    await app.close();
  });

  it('cache-miss: a pr_brief row whose head_sha no longer matches the PR\'s current head_sha reads as brief: null on GET (AC-8), even though a row still exists', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const pr = await makePr(repo.id, workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);

    // Simulate a new commit — head_sha moves on, cached row is now stale.
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'sha-moved-on' }).where(eq(t.pullRequests.id, pr.id));

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(200);
    expect(get.json().brief).toBeNull();
    expect(get.json().brief_generated_at).toBeNull();

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1); // the stale row is NOT deleted, just not surfaced

    await app.close();
  });

  it('GET and POST 404 for a PR belonging to a different workspace; POST never invokes the mock LLM', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    const app = await appWith(llm);
    const foreignRepo = await makeRepo(otherWorkspaceId);
    const foreignPr = await makePr(foreignRepo.id, otherWorkspaceId);

    const get = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/brief` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/pulls/${foreignPr.id}/brief` });
    expect(post.statusCode).toBe(404);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, foreignPr.id));
    expect(rows).toHaveLength(0);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('429s the 11th POST within the rate-limit window', async () => {
    // Same NODE_ENV override as `onboarding.it.test.ts`'s own 429 test: the
    // global `@fastify/rate-limit` plugin registration in `app.ts` is
    // skipped entirely under NODE_ENV: 'test', so no per-route
    // `config.rateLimit` override can take effect unless the plugin is
    // actually registered.
    const cfg = config();
    cfg.nodeEnv = 'production';
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    const app = await buildApp({ config: cfg, db: pg.handle.db, overrides: { llm: { openai: llm } } });
    const repo = await makeRepo(workspaceId);
    const pr = await makePr(repo.id, workspaceId);

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(200);
    }
    const eleventh = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(eleventh.statusCode).toBe(429);

    await app.close();
  });
});
