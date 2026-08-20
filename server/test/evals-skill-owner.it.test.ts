import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { SKILL_EVAL_SYSTEM_PROMPT } from '../src/modules/evals/constants.js';
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

const NO_FINDINGS_REVIEW: Review = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };

/**
 * SPEC-06 T7 — skill-owned eval routes (`GET/POST /skills/:id/evals`,
 * `PUT/DELETE /skills/:id/evals/:caseId`, `POST /skills/:id/evals/:caseId/run`,
 * `GET/POST /skills/:id/eval-runs`). The skill-eval run config is built via
 * `resolveFeatureModel(..., 'skill_eval')`, whose default provider is
 * `'openrouter'` (server/INSIGHTS.md 2026-08-04) — every test here mocks
 * `overrides.llm.openrouter` explicitly, never relying on a mock registered
 * for a different feature's provider.
 */
d('skill-owned evals (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(structured: Review) {
    const llm = new MockLLMProvider('openrouter', { structured });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: llm },
      },
    });
    return { app, llm };
  }

  async function createSkill(app: Awaited<ReturnType<typeof appWith>>['app'], overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Corner Cases',
        description: 'd',
        body: '# Corner Cases\nFlag test files missing edge-case coverage.',
        ...overrides,
      },
    });
    return res.json();
  }

  it('CRUD roundtrip for a skill-owned eval case', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app);

    const created = (
      await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/evals`,
        payload: { name: 'skill-case-1', input_diff: DIFF, expected_output: [] },
      })
    ).json();
    expect(created.id).toBeDefined();

    const listed = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/evals` })).json();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/evals/${created.id}`,
        payload: { name: 'skill-case-1-renamed' },
      })
    ).json();
    expect(updated.name).toBe('skill-case-1-renamed');

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}/evals/${created.id}` });
    expect(del.statusCode).toBe(200);
    const afterDelete = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/evals` })).json();
    expect(afterDelete).toHaveLength(0);

    await app.close();
  });

  it('single-run persists an eval_runs row with system_prompt_snapshot = SKILL_EVAL_SYSTEM_PROMPT (AC-16 is ubiquitous — not scoped to bulk runs) and the run response reflects it reaching the model', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app);
    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/evals`,
        payload: { name: 'single-run-case', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/evals/${evalCase.id}/run` });
    expect(res.statusCode).toBe(200);

    const call = [...llm.calls].reverse().find((c) => c.method === 'completeStructured');
    const req = call?.req as { messages?: { role: string; content: string }[] } | undefined;
    const promptText = (req?.messages ?? []).map((m) => m.content).join('\n');
    expect(promptText).toContain(SKILL_EVAL_SYSTEM_PROMPT);

    const [runRow] = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.caseId, evalCase.id), isNull(t.evalRuns.runGroupId)));
    expect(runRow).toBeDefined();
    expect(runRow!.systemPromptSnapshot).toBe(SKILL_EVAL_SYSTEM_PROMPT);

    await app.close();
  });

  it('bulk run (POST /skills/:id/eval-runs) persists N eval_runs rows sharing one run_group_id, each with system_prompt_snapshot = SKILL_EVAL_SYSTEM_PROMPT', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app);
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/evals`,
      payload: { name: 'bulk-1', input_diff: DIFF, expected_output: [] },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/evals`,
      payload: { name: 'bulk-2', input_diff: DIFF, expected_output: [] },
    });

    const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases).toHaveLength(2);
    for (const c of body.cases) {
      expect(c.system_prompt_snapshot).toBe(SKILL_EVAL_SYSTEM_PROMPT);
      expect(c.run_group_id).toBe(body.run_group_id);
    }

    const history = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-runs` })).json();
    expect(history).toHaveLength(2);
    for (const row of history) {
      expect(row.system_prompt_snapshot).toBe(SKILL_EVAL_SYSTEM_PROMPT);
    }

    await app.close();
  });

  it('a disabled skill-under-test still runs on its current body (AC-15) — enabled does NOT gate the skill being evaluated', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app, { enabled: false });
    // Confirm the skill really is disabled before trusting the run result.
    expect(skill.enabled).toBe(false);

    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/evals`,
        payload: { name: 'disabled-skill-case', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/evals/${evalCase.id}/run` });
    expect(res.statusCode).toBe(200);

    const call = [...llm.calls].reverse().find((c) => c.method === 'completeStructured');
    const req = call?.req as { messages?: { role: string; content: string }[] } | undefined;
    const promptText = (req?.messages ?? []).map((m) => m.content).join('\n');
    // The skill's own body reached the model despite `enabled: false` — the
    // whole point of the tab is testing a not-yet-enabled skill (AC-15).
    expect(promptText).toContain('Flag test files missing edge-case coverage');

    await app.close();
  });

  it('POST /skills/:id/eval-runs on an empty case set returns 422 (ValidationError → 422, not 400 — server/INSIGHTS.md 2026-08-01)', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app);

    const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('429s past the bulk-run rate-limit ({max: 5, timeWindow: "1 minute"}, AC-18 — same config as POST /agents/:id/eval-runs)', async () => {
    const cfg = config();
    // The global @fastify/rate-limit plugin only registers outside
    // NODE_ENV: 'test' — same override as evals.it.test.ts's 429 test.
    cfg.nodeEnv = 'production';
    const llm = new MockLLMProvider('openrouter', { structured: NO_FINDINGS_REVIEW });
    const app = await buildApp({
      config: cfg,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), llm: { openrouter: llm } },
    });

    const skill = await createSkill(app);
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/evals`,
      payload: { name: 'rl-1', input_diff: DIFF, expected_output: [] },
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
      expect(res.statusCode).toBe(200);
    }
    const sixth = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(sixth.statusCode).toBe(429);

    await app.close();
  });

  it('404s every skill-eval route for a foreign-workspace skill id BEFORE any LLM call or DB write (AC-19)', async () => {
    const { app, llm } = await appWith(NO_FINDINGS_REVIEW);
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'Other Workspace (skill evals)' }).returning();
    const foreign = await new SkillsRepository(db).insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Skill',
      description: 'd',
      type: 'convention',
      source: 'manual',
      body: '# foreign',
    });

    const beforeCases = (await db.select().from(t.evalCases)).length;
    const beforeRuns = (await db.select().from(t.evalRuns)).length;

    const list = await app.inject({ method: 'GET', url: `/skills/${foreign.id}/evals` });
    expect(list.statusCode).toBe(404);

    const create = await app.inject({
      method: 'POST',
      url: `/skills/${foreign.id}/evals`,
      payload: { name: 'x', input_diff: DIFF, expected_output: [] },
    });
    expect(create.statusCode).toBe(404);

    const bulk = await app.inject({ method: 'POST', url: `/skills/${foreign.id}/eval-runs` });
    expect(bulk.statusCode).toBe(404);

    const runs = await app.inject({ method: 'GET', url: `/skills/${foreign.id}/eval-runs` });
    expect(runs.statusCode).toBe(404);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    expect((await db.select().from(t.evalCases)).length).toBe(beforeCases);
    expect((await db.select().from(t.evalRuns)).length).toBe(beforeRuns);

    await app.close();
  });

  it('a bulk run leaves the single-case run_group_id: null row queryable directly, still with its own snapshot (AC-16)', async () => {
    const { app } = await appWith(NO_FINDINGS_REVIEW);
    const skill = await createSkill(app);
    const evalCase = (
      await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/evals`,
        payload: { name: 'snap-single', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const singleRes = await app.inject({ method: 'POST', url: `/skills/${skill.id}/evals/${evalCase.id}/run` });
    expect(singleRes.statusCode).toBe(200);
    const [singleRunRow] = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.caseId, evalCase.id), isNull(t.evalRuns.runGroupId)));
    expect(singleRunRow).toBeDefined();
    // Unlike the agent single-run convention (SPEC-05 T15, left null on
    // purpose), a skill single-run DOES carry the snapshot — AC-16 is
    // "ubiquitous" over every row a skill-run produces, not scoped to
    // runSet's bulk rows only. `run()`'s `ownerKind === 'skill'` branch
    // (service.ts) sets this; the agent branch stays null, unchanged.
    expect(singleRunRow!.systemPromptSnapshot).toBe(SKILL_EVAL_SYSTEM_PROMPT);

    await app.close();
  });
});
