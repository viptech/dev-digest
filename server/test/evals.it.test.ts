import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/test/foo.test.ts b/test/foo.test.ts
--- a/test/foo.test.ts
+++ b/test/foo.test.ts
@@ -1,2 +1,5 @@
 test('happy path', () => {
+  expect(add(1, 2)).toBe(3);
 });`;

const HAPPY_PATH_ONLY_REVIEW: Review = {
  verdict: 'comment',
  summary: 'Only the happy path is tested.',
  score: 80,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'test',
      title: 'Missing corner-case coverage',
      file: 'test/foo.test.ts',
      start_line: 3,
      end_line: 3,
      rationale: 'No test for negative numbers or overflow.',
      confidence: 0.8,
    },
  ],
};
const NO_FINDINGS_REVIEW: Review = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };

d('evals — run a case with/without a skill (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(structured: Review) {
    const llm = new MockLLMProvider('openai', { structured });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
    return { app, llm };
  }

  /** The `messages` sent on the most recent completeStructured call, joined into one string. */
  function lastPromptText(llm: MockLLMProvider): string {
    const call = [...llm.calls].reverse().find((c) => c.method === 'completeStructured');
    const req = call?.req as { messages?: { role: string; content: string }[] } | undefined;
    return (req?.messages ?? []).map((m) => m.content).join('\n');
  }

  it('without the skill, a happy-path-only test PASSES the case (agent finds nothing, matching expected=[])', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Skill Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review tests' },
      })
    ).json();

    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/evals`,
        payload: {
          name: 'happy-path-only',
          input_diff: DIFF,
          expected_output: [],
        },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals/${evalCase.id}/run`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.traces_passed).toBe(1); // pass: expected [] and got []

    // No skill linked → the skill's distinctive text must NOT reach the LLM call.
    expect(lastPromptText(llm).length).toBeGreaterThan(0); // a real call was made
    expect(lastPromptText(llm)).not.toContain('Flag test files missing edge-case coverage');

    await app.close();
  });

  it('running a case with an empty diff is rejected with 422 instead of a misleading pass', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Empty Diff Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review tests' },
      })
    ).json();

    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/evals`,
        payload: { name: 'no-diff', input_diff: '   ', expected_output: [] },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals/${evalCase.id}/run`,
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('with a corner-case skill linked+enabled, the model now returns an extra (unlabeled) finding — case still PASSES under the new neutral-zone scorer, proving the skill reached the model', async () => {
    const { app, llm } = await appWith(HAPPY_PATH_ONLY_REVIEW);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'With Skill Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review tests' },
      })
    ).json();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Corner Cases',
          description: 'd',
          body: '# Corner Cases\nFlag test files missing edge-case coverage.',
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/evals`,
        payload: { name: 'happy-path-only', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals/${evalCase.id}/run`,
    });
    const body = res.json();
    // SPEC-05 AC-7: a finding outside every annotated zone is NEUTRAL, not a
    // false positive — expected_output: [] means no zones at all, so this
    // case still passes (recall/precision vacuously 1) even though the model
    // now returns a finding it didn't before. The `actual` output still
    // proves the skill really changed model behavior — that's the point of
    // this scenario, not the pass/fail bit.
    expect(body.run.traces_passed).toBe(1);
    expect(body.run.per_trace[0].actual).toHaveLength(1);

    // Prove the flip is caused by skill resolution actually reaching the LLM
    // call — not just by which canned fixture this scenario configured.
    expect(lastPromptText(llm)).toContain('Flag test files missing edge-case coverage');

    await app.close();
  });

  // ---- T2: run_group_id round-trip ---------------------------------------
  it('several eval_runs rows can share one run_group_id and be read back grouped (T2)', async () => {
    const { db } = pg.handle;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    const agentsRepo = new AgentsRepository(db);
    const agent = await agentsRepo.insert({
      workspaceId: ws!.id,
      name: 'Group Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'x',
    });
    const repo = new EvalsRepository(db);
    const case1 = await repo.insert({
      workspaceId: ws!.id,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'group-case-1',
      inputDiff: DIFF,
      expectedOutput: [],
    });
    const case2 = await repo.insert({
      workspaceId: ws!.id,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'group-case-2',
      inputDiff: DIFF,
      expectedOutput: [],
    });
    const groupId = randomUUID();
    await repo.insertRun({
      caseId: case1.id,
      runGroupId: groupId,
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0,
    });
    await repo.insertRun({
      caseId: case2.id,
      runGroupId: groupId,
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0,
    });
    // An unrelated single-case run (no run_group_id) must NOT show up in the
    // grouped set-run history.
    await repo.insertRun({
      caseId: case1.id,
      runGroupId: null,
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 5,
      costUsd: 0,
    });

    const grouped = await repo.listSetRunsByOwner(ws!.id, 'agent', agent.id);
    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map((r) => r.runGroupId))).toEqual(new Set([groupId]));
  });

  // ---- T4/T5: bulk set-run, aggregate, failure isolation, rate-limit, access control ----
  it('POST /agents/:id/eval-runs runs every case, persisting N rows sharing one run_group_id (AC-11/AC-12)', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Bulk Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals`,
      payload: { name: 'bulk-1', input_diff: DIFF, expected_output: [] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals`,
      payload: { name: 'bulk-2', input_diff: DIFF, expected_output: [] },
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases).toHaveLength(2);
    expect(new Set(body.cases.map((c: { run_group_id: string }) => c.run_group_id))).toEqual(
      new Set([body.run_group_id]),
    );
    expect(body.aggregate.recall).toBe(1);
    expect(body.aggregate.precision).toBe(1);

    const history = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(history).toHaveLength(2);

    await app.close();
  });

  it('POST /agents/:id/eval-runs on an agent with zero cases returns 422 with zero LLM calls (AC-13)', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Empty Set Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('one case failing inside a bulk run does not abort the rest of the set (AC-14)', async () => {
    const llm = new MockLLMProvider('openai', { structured: NO_FINDINGS_REVIEW });
    const originalCompleteStructured = llm.completeStructured.bind(llm);
    let callCount = 0;
    llm.completeStructured = (async (req: unknown) => {
      callCount += 1;
      if (callCount === 2) throw new Error('simulated LLM failure');
      return originalCompleteStructured(req as never);
    }) as typeof llm.completeStructured;

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), llm: { openai: llm } },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Flaky Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    for (const name of ['flaky-1', 'flaky-2', 'flaky-3']) {
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/evals`,
        payload: { name, input_diff: DIFF, expected_output: [] },
      });
    }

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases).toHaveLength(3);
    const failed = body.cases.filter((c: { pass: boolean; recall: number | null }) => c.pass === false && c.recall === null);
    const succeeded = body.cases.filter((c: { recall: number | null }) => c.recall !== null);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('429s past the bulk-run rate-limit ({max: 5, timeWindow: "1 minute"}, AC-22)', async () => {
    const cfg = config();
    // The global @fastify/rate-limit plugin only registers outside
    // NODE_ENV: 'test' — same override as brief.it.test.ts's 429 test.
    cfg.nodeEnv = 'production';
    const llm = new MockLLMProvider('openai', { structured: NO_FINDINGS_REVIEW });
    const app = await buildApp({
      config: cfg,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), llm: { openai: llm } },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'RateLimit Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evals`,
      payload: { name: 'rl-1', input_diff: DIFF, expected_output: [] },
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(res.statusCode).toBe(200);
    }
    const sixth = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(sixth.statusCode).toBe(429);

    await app.close();
  });

  it('404s POST /agents/:id/eval-runs for a foreign-workspace agent id (AC-23)', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'Other Workspace (evals bulk)' }).returning();
    const foreign = await new AgentsRepository(db).insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'x',
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${foreign.id}/eval-runs` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // ---- T6: POST /findings/:id/eval-case ----------------------------------
  describe('POST /findings/:id/eval-case (turn a decided finding into a regression eval case)', () => {
    let repoSeq = 0;
    let prSeq = 0;

    async function makeRepo(workspaceId: string) {
      const name = `evals-finding-${repoSeq++}`;
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
        .returning();
      return repo!;
    }

    async function makePr(repoId: string, workspaceId: string) {
      const number = prSeq++;
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number,
          title: `PR #${number}`,
          author: 'marisa.koch',
          branch: `feat/pr-${number}`,
          base: 'main',
          headSha: `sha-${number}`,
        })
        .returning();
      return pr!;
    }

    async function makeReviewAndFinding(
      workspaceId: string,
      prId: string,
      agentId: string | null,
      decision: 'accepted' | 'dismissed' | 'none',
    ) {
      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId, prId, agentId, kind: 'review', verdict: 'comment', summary: 's', score: 80, model: 'seed' })
        .returning();
      const [finding] = await pg.handle.db
        .insert(t.findings)
        .values({
          reviewId: review!.id,
          file: 'src/routes/users.ts',
          startLine: 5,
          endLine: 5,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          rationale: 'r',
          confidence: 0.9,
          acceptedAt: decision === 'accepted' ? new Date() : null,
          dismissedAt: decision === 'dismissed' ? new Date() : null,
        })
        .returning();
      return { review: review!, finding: finding! };
    }

    it('an accepted finding creates a must_find case', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'FromFinding Agent A', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
        })
      ).json();
      const repo = await makeRepo(ws!.id);
      const pr = await makePr(repo.id, ws!.id);
      await db
        .insert(t.prFiles)
        .values({ prId: pr.id, path: 'src/routes/users.ts', patch: '@@ -1,3 +1,3 @@\n-old\n+new' });
      const { finding } = await makeReviewAndFinding(ws!.id, pr.id, agent.id, 'accepted');

      const beforeCount = (await db.select().from(t.evalCases)).length;
      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      // T13: 200, not 201 — nothing is persisted, this returns a draft the
      // client opens in EvalCaseModal; the row is only created on Save/Run.
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.owner_id).toBe(agent.id);
      expect(body.id).toBeUndefined();
      expect(body.expected_output).toEqual([
        { type: 'must_find', file: 'src/routes/users.ts', start_line: 5, end_line: 5, severity: 'CRITICAL', category: 'security' },
      ]);
      expect(body.input_diff).toContain('diff --git a/src/routes/users.ts b/src/routes/users.ts');
      const afterCount = (await db.select().from(t.evalCases)).length;
      expect(afterCount).toBe(beforeCount);

      await app.close();
    });

    it('a dismissed finding creates a must_not_flag draft (no row persisted)', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'FromFinding Agent B', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
        })
      ).json();
      const repo = await makeRepo(ws!.id);
      const pr = await makePr(repo.id, ws!.id);
      const { finding } = await makeReviewAndFinding(ws!.id, pr.id, agent.id, 'dismissed');

      const beforeCount = (await db.select().from(t.evalCases)).length;
      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      expect(res.statusCode).toBe(200);
      expect(res.json().expected_output[0].type).toBe('must_not_flag');
      const afterCount = (await db.select().from(t.evalCases)).length;
      expect(afterCount).toBe(beforeCount);

      await app.close();
    });

    it('a finding with no accept/dismiss decision returns 422', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'FromFinding Agent C', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
        })
      ).json();
      const repo = await makeRepo(ws!.id);
      const pr = await makePr(repo.id, ws!.id);
      const { finding } = await makeReviewAndFinding(ws!.id, pr.id, agent.id, 'none');

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      expect(res.statusCode).toBe(422);

      await app.close();
    });

    it('a review with no agent_id returns 422', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
      const repo = await makeRepo(ws!.id);
      const pr = await makePr(repo.id, ws!.id);
      const { finding } = await makeReviewAndFinding(ws!.id, pr.id, null, 'accepted');

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      expect(res.statusCode).toBe(422);

      await app.close();
    });

    it('a finding on a foreign-workspace PR returns 404', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [otherWs] = await db.insert(t.workspaces).values({ name: 'Other Workspace (evals finding)' }).returning();
      const repo = await makeRepo(otherWs!.id);
      const pr = await makePr(repo.id, otherWs!.id);
      const foreignAgent = await new AgentsRepository(db).insert({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent For Finding',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      });
      const { finding } = await makeReviewAndFinding(otherWs!.id, pr.id, foreignAgent.id, 'accepted');

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      expect(res.statusCode).toBe(404);

      await app.close();
    });
  });

  // ---- T9/T14: GET /eval-dashboard — per-agent set-run history, sparkline/version data ----
  describe('GET /eval-dashboard (AC-20/AC-21, T14)', () => {
    it("an agent with zero set-runs shows recent_runs: [] and last_run: null (AC-21, 'Never run')", async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Never Run Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'x' },
        })
      ).json();

      const res = await app.inject({ method: 'GET', url: '/eval-dashboard' });
      expect(res.statusCode).toBe(200);
      const row = res.json().find((r: { agent_id: string }) => r.agent_id === agent.id);
      expect(row).toMatchObject({ agent_name: 'Never Run Agent', agent_model: 'gpt-4o-mini', recent_runs: [], last_run: null });

      await app.close();
    });

    it('an agent with multiple set-runs lists all of them in recent_runs, newest first, with an ascending per-agent version (T14)', async () => {
      const { app } = await appWith(NO_FINDINGS_REVIEW);
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
      const agentsRepo = new AgentsRepository(db);
      const agent = await agentsRepo.insert({
        workspaceId: ws!.id,
        name: 'Dashboard History Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      });
      const repo = new EvalsRepository(db);
      const evalCase = await repo.insert({
        workspaceId: ws!.id,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: 'dashboard-history-case',
        inputDiff: DIFF,
        expectedOutput: [],
      });

      // Two set-runs, oldest first — insertRun doesn't take an explicit
      // ranAt, so insert sequentially and rely on DB-assigned timestamps
      // ordering them; the `version` assertion below only depends on
      // relative order, not exact values.
      const olderGroupId = randomUUID();
      await repo.insertRun({
        caseId: evalCase.id,
        runGroupId: olderGroupId,
        actualOutput: [],
        pass: false,
        recall: 0.5,
        precision: 0.6,
        citationAccuracy: 0.7,
        durationMs: 10,
        costUsd: 0,
      });
      await new Promise((r) => setTimeout(r, 10)); // ensure a distinct, later ranAt
      const newerGroupId = randomUUID();
      await repo.insertRun({
        caseId: evalCase.id,
        runGroupId: newerGroupId,
        actualOutput: [],
        pass: true,
        recall: 0.9,
        precision: 0.8,
        citationAccuracy: 1,
        durationMs: 10,
        costUsd: 0,
      });

      const res = await app.inject({ method: 'GET', url: '/eval-dashboard' });
      expect(res.statusCode).toBe(200);
      const row = res.json().find((r: { agent_id: string }) => r.agent_id === agent.id);

      expect(row.recent_runs).toHaveLength(2);
      // Newest-first: the last-inserted (newer) group leads.
      expect(row.recent_runs[0].run_group_id).toBe(newerGroupId);
      expect(row.recent_runs[1].run_group_id).toBe(olderGroupId);
      // version is an ascending per-agent ordinal — 1 = oldest, 2 = newest.
      expect(row.recent_runs[1].version).toBe(1);
      expect(row.recent_runs[0].version).toBe(2);
      // last_run mirrors recent_runs[0] (the newest).
      expect(row.last_run.run_group_id).toBe(newerGroupId);
      expect(row.last_run.recall).toBeCloseTo(0.9);
      expect(row.last_run.cases_passed).toBe(1);

      await app.close();
    });
  });
});
