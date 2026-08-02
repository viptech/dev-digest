import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
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

  function appWith(structured: Review) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  it('without the skill, a happy-path-only test PASSES the case (agent finds nothing, matching expected=[])', async () => {
    const app = await appWith(NO_FINDINGS_REVIEW);
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

    await app.close();
  });

  it('with a corner-case skill linked+enabled, the SAME expected=[] case now FAILS (agent flags the gap)', async () => {
    const app = await appWith(HAPPY_PATH_ONLY_REVIEW);
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
    // The (mocked) model now returns a finding — expected [] but got 1 → fails.
    expect(body.run.traces_passed).toBe(0);
    expect(body.run.per_trace[0].actual).toHaveLength(1);

    await app.close();
  });
});
