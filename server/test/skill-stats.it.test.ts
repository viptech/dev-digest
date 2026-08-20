import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-stats] Docker not available — skipping integration tests.');
}

d('skill stats — real join through agent_skills -> agent_runs -> reviews -> findings (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;
  let prSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function makePr() {
    const name = `skill-stats-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const number = prSeq++;
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
        title: `PR #${number}`,
        author: 'a',
        branch: `b-${number}`,
        base: 'main',
        headSha: `sha-${number}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return pr!;
  }

  async function makeRun(
    agentId: string,
    opts: { skillIds: string[] | null; costUsd: number | null; findingsCount: number | null; status?: string },
  ) {
    const pr = await makePr();
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        prId: pr.id,
        status: opts.status ?? 'done',
        costUsd: opts.costUsd,
        findingsCount: opts.findingsCount,
        skillIds: opts.skillIds,
      })
      .returning();
    return { run: run!, pr };
  }

  async function makeReview(prId: string, agentId: string, runId: string) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, runId, kind: 'review', verdict: 'comment', summary: 's', score: 80, model: 'seed' })
      .returning();
    return review!;
  }

  async function makeFinding(
    reviewId: string,
    category: string,
    decision: 'accepted' | 'dismissed' | 'none',
  ) {
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId,
        file: 'src/routes/users.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category,
        title: 'finding',
        rationale: 'r',
        confidence: 0.8,
        acceptedAt: decision === 'accepted' ? new Date() : null,
        dismissedAt: decision === 'dismissed' ? new Date() : null,
      })
      .returning();
    return finding!;
  }

  it('AC-23..AC-26: aggregates used_by_agents, pull_rate, accept_rate, and cost-by-category over the real join chain', async () => {
    const app = await makeApp();

    const agent1 = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skill Stats Agent 1', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    const agent2 = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skill Stats Agent 2', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Corner Cases', description: 'Checks corner cases', body: 'Look for corner cases.' },
      })
    ).json();

    expect((await app.inject({ method: 'POST', url: `/agents/${agent1.id}/skills`, payload: { skill_id: skill.id } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/agents/${agent2.id}/skills`, payload: { skill_id: skill.id } })).statusCode).toBe(200);

    // agent1: one run that pulled the skill (2 findings, split $1 evenly => $0.50 each category)...
    const { run: run1, pr: pr1 } = await makeRun(agent1.id, { skillIds: [skill.id], costUsd: 1, findingsCount: 2 });
    const review1 = await makeReview(pr1.id, agent1.id, run1.id);
    await makeFinding(review1.id, 'security', 'accepted');
    await makeFinding(review1.id, 'perf', 'dismissed');

    // ...and one run that did NOT pull the skill (denominator only, no review needed).
    await makeRun(agent1.id, { skillIds: [], costUsd: 0.2, findingsCount: 1 });

    // agent2: one run that pulled the skill, null cost (must NOT contribute to cost_by_category),
    // one pending finding (must NOT move accept_rate).
    const { run: run3, pr: pr3 } = await makeRun(agent2.id, { skillIds: [skill.id], costUsd: null, findingsCount: 1 });
    const review3 = await makeReview(pr3.id, agent2.id, run3.id);
    await makeFinding(review3.id, 'security', 'none');

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();

    expect(stats.used_by_agents).toBe(2); // AC-23: distinct linking agents, direct attachment
    expect(stats.pull_rate).toBeCloseTo(2 / 3); // AC-24: 2 pulled / 3 total done runs of linking agents
    expect(stats.accept_rate).toBeCloseTo(0.5); // AC-25: 1 accepted / (1 accepted + 1 dismissed); pending excluded

    const byAgent = Object.fromEntries(stats.agents.map((a: { agent_id: string; pull_rate: number | null }) => [a.agent_id, a.pull_rate]));
    expect(byAgent[agent1.id]).toBeCloseTo(0.5); // 1 of agent1's 2 done runs pulled the skill
    expect(byAgent[agent2.id]).toBeCloseTo(1); // 1 of agent2's 1 done run pulled the skill

    const byCategory = Object.fromEntries(
      stats.cost_by_category.map((c: { category: string; cost_usd: number }) => [c.category, c.cost_usd]),
    );
    expect(byCategory.security).toBeCloseTo(0.5); // only run1's share — run3's null costUsd added nothing
    expect(byCategory.perf).toBeCloseTo(0.5);
    const total = Object.values(byCategory).reduce((sum: number, v) => sum + (v as number), 0);
    expect(total).toBeCloseTo(1); // equals run1's actual cost; run3 (null cost) contributed nothing

    await app.close();
  });

  it('AC-27: a never-linked skill returns the empty/zero state without a failing query', async () => {
    const app = await makeApp();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Unused Skill', description: 'Never linked', body: 'Body.' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.used_by_agents).toBe(0);
    expect(stats.pull_rate).toBeNull();
    expect(stats.accept_rate).toBeNull();
    expect(stats.agents).toEqual([]);
    expect(stats.cost_by_category).toEqual([]);

    await app.close();
  });

  it('404s for an unknown skill id (before computing anything)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/skills/00000000-0000-0000-0000-000000000000/stats` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
