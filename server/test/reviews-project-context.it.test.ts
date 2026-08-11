/**
 * SPEC-01 (Project Context) — T4/T5: a full review run actually injects
 * attached-doc content into `## Project context` via the existing
 * `reviewer-core` slot, `RunTrace.specs_read` reflects it (AC-16), and the
 * cross-repo case (doc attached from repo A, PR reviewed in repo B) works
 * as the intended, supported case (AC-11) — not a degrade path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const EMPTY_REVIEW: Review = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };
const MOCK_INTENT = {
  intent: 'test PR',
  in_scope: [],
  out_of_scope: [],
  confidence: 'high' as const,
  source: 'description' as const,
};

let repoSeq = 0;
async function makeRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `rpc-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

async function makePr(db: PgFixture['handle']['db'], workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 1,
      title: 'Add a config key',
      author: 'someone',
      branch: 'feat/x',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: null,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return pr!;
}

d('project context reaches the review prompt (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneA: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    cloneA = await mkdtemp(join(tmpdir(), 'rpc-clone-a-'));
    await mkdir(join(cloneA, 'specs'), { recursive: true });
    await writeFile(
      join(cloneA, 'specs', 'public-api.md'),
      '# Public API\nThe `api/` module must not import `db/` directly.',
    );
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(cloneA, { recursive: true, force: true });
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: EMPTY_REVIEW }),
          openrouter: new MockLLMProvider('openrouter', { structured: MOCK_INTENT }),
        },
      },
    });
  }

  it(
    'a doc attached from repo A is injected verbatim when the PR is reviewed ' +
      'in repo B — cross-repo context is the supported case, not a degrade (AC-11, AC-13, AC-16)',
    async () => {
      const app = await appWith();
      const repoA = await makeRepo(pg.handle.db, workspaceId, cloneA);
      const repoB = await makeRepo(pg.handle.db, workspaceId, null); // PR's own repo — no clone needed for the diff (MockGitClient supplies it)
      const pr = await makePr(pg.handle.db, workspaceId, repoB.id);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Cross-Repo Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
        })
      ).json();

      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context-docs`,
        payload: { docs: [{ repo_id: repoA.id, path: 'specs/public-api.md' }] },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      expect(res.statusCode).toBe(200);
      const runId = res.json().runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      expect(trace.specs_read).toEqual([`acme/${repoA.name}:specs/public-api.md`]);
      expect(trace.prompt_assembly.specs).toContain(`### acme/${repoA.name} — specs/public-api.md`);
      expect(trace.prompt_assembly.specs).toContain('must not import `db/` directly');
      // Untrusted delimiter-wrapped — AC-14, no new injection mechanism.
      expect(trace.prompt_assembly.specs).toContain('<untrusted source="spec-0">');

      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(run!.status).toBe('done');

      await app.close();
    },
  );

  it('a renamed/deleted attached doc degrades cleanly — run still succeeds (AC-12)', async () => {
    const app = await appWith();
    const repoA = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const repoB = await makeRepo(pg.handle.db, workspaceId, null);
    const pr = await makePr(pg.handle.db, workspaceId, repoB.id);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Degrade Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    // "specs/missing.md" was never written to cloneA — the attach itself
    // succeeds (it's a valid specs/ path, AC-15 only guards traversal +
    // allowed roots, not existence), but read-time resolution finds nothing.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [{ repo_id: repoA.id, path: 'specs/missing.md' }] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done'); // never fails the run

    await app.close();
  });

  it(
    'AC-15 defense-in-depth: a doc row outside the allowed roots (bypassing ' +
      'attach-time validation, e.g. a stale row) is dropped at read time too',
    async () => {
      const app = await appWith();
      const repoA = await makeRepo(pg.handle.db, workspaceId, cloneA);
      const repoB = await makeRepo(pg.handle.db, workspaceId, null);
      const pr = await makePr(pg.handle.db, workspaceId, repoB.id);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Defense In Depth Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'r' },
        })
      ).json();

      // Attach a legitimate doc via the API, then insert a second row DIRECTLY
      // (bypassing the service's AC-15 validation entirely) with a path
      // outside specs/docs/insights — simulates a stale/corrupted row a
      // future migration or manual DB edit could leave behind.
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context-docs`,
        payload: { docs: [{ repo_id: repoA.id, path: 'specs/public-api.md' }] },
      });
      await pg.handle.db
        .insert(t.agentContextDocs)
        .values({ agentId: agent.id, repoId: repoA.id, path: 'src/index.ts', order: 1 });

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      const runId = res.json().runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      // Only the legitimate doc made it in — the out-of-roots row was dropped,
      // not just at attach time (which it bypassed) but at read time too.
      expect(trace.specs_read).toEqual([`acme/${repoA.name}:specs/public-api.md`]);

      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(run!.status).toBe('done');

      await app.close();
    },
  );

  it('an agent with no attached docs has an unchanged prompt (specs omitted, not an empty section)', async () => {
    const app = await appWith();
    const repoB = await makeRepo(pg.handle.db, workspaceId, null);
    const pr = await makePr(pg.handle.db, workspaceId, repoB.id);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Context Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();

    await app.close();
  });
});
