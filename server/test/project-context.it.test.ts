/**
 * SPEC-01 (Project Context) — T3: attach/detach/reorder, AC-15's
 * traversal/allowlist-root guard, cross-workspace `repo_id` rejection (NFR
 * access control), and `resolveAgentContext`'s AC-9/AC-10 dedup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function makeRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `pc-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

d('project-context attach/detach/reorder (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let cloneA: string;
  let cloneB: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // A second workspace, for the cross-workspace repo_id rejection test.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'Other Workspace' })
      .returning();
    otherWorkspaceId = otherWs!.id;

    cloneA = await mkdtemp(join(tmpdir(), 'pc-clone-a-'));
    await mkdir(join(cloneA, 'specs'), { recursive: true });
    await writeFile(join(cloneA, 'specs', 'public-api.md'), '# Public API');
    await mkdir(join(cloneA, 'src'), { recursive: true });
    await writeFile(join(cloneA, 'src', 'index.ts'), 'export {}');

    cloneB = await mkdtemp(join(tmpdir(), 'pc-clone-b-'));
    await mkdir(join(cloneB, 'docs'), { recursive: true });
    await writeFile(join(cloneB, 'docs', 'architecture.md'), '# Architecture');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(cloneA, { recursive: true, force: true });
    await rm(cloneB, { recursive: true, force: true });
  });

  function appWith() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('discovers .md docs under specs/docs/insights for a repo (AC-1, AC-2)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        path: 'specs/public-api.md',
        category: 'specs',
        chars: Buffer.byteLength('# Public API'),
        used_by_agents: 0,
        used_by_skills: 0,
      },
    ]);

    await app.close();
  });

  it('used_by_agents and used_by_skills are counted independently — a doc attached only to a skill is not silently shown as unused (bug caught in live testing)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Usage Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Usage Skill', description: 'd', body: '# Usage Skill' },
      })
    ).json();

    // Only the agent attaches it first — used_by_skills must stay 0, not
    // silently omitted/undefined.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [{ repo_id: repo.id, path: 'specs/public-api.md' }] },
    });
    const agentOnly = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(agentOnly.json()).toEqual([
      expect.objectContaining({ used_by_agents: 1, used_by_skills: 0 }),
    ]);

    // The same doc also attaches to a skill — both counts now reflect their
    // own, independent attachment, neither one folded into the other.
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-docs`,
      payload: { docs: [{ repo_id: repo.id, path: 'specs/public-api.md' }] },
    });
    const both = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(both.json()).toEqual([expect.objectContaining({ used_by_agents: 1, used_by_skills: 1 })]);

    // Detach the agent — a skill-only attachment must still show its own
    // count, not read as completely unused (the exact bug this test guards).
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [] },
    });
    const skillOnly = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(skillOnly.json()).toEqual([
      expect.objectContaining({ used_by_agents: 0, used_by_skills: 1 }),
    ]);

    await app.close();
  });

  it("previews a discovered document's full content (AC-4's Preview action)", async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=specs/public-api.md`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ content: '# Public API' });

    await app.close();
  });

  it('404s a preview request for a non-markdown path (never reads it)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=src/index.ts`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('404s a preview request for a path-traversal escape (never reads it)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=../../../../etc/passwd`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('returns [] (not an error) for a repo with no clonePath yet (AC-3)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, null);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    await app.close();
  });

  it('attaches, lists (ordered), and reorders an agent\'s docs (AC-4, AC-6)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const repoB = await makeRepo(pg.handle.db, workspaceId, cloneB);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'PC Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: {
        docs: [
          { repo_id: repoB.id, path: 'docs/architecture.md' },
          { repo_id: repo.id, path: 'specs/public-api.md' },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual([
      { repo_id: repoB.id, path: 'docs/architecture.md', order: 0, owner: 'acme', name: repoB.name },
      { repo_id: repo.id, path: 'specs/public-api.md', order: 1, owner: 'acme', name: repo.name },
    ]);

    const listed = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-docs` });
    expect(listed.json()).toHaveLength(2);

    // Reorder: swap the two.
    const reordered = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: {
        docs: [
          { repo_id: repo.id, path: 'specs/public-api.md' },
          { repo_id: repoB.id, path: 'docs/architecture.md' },
        ],
      },
    });
    expect(reordered.json().map((d: { path: string }) => d.path)).toEqual([
      'specs/public-api.md',
      'docs/architecture.md',
    ]);

    // Detach (empty set).
    const cleared = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [] },
    });
    expect(cleared.json()).toEqual([]);

    await app.close();
  });

  it('rejects (422) a non-markdown path — never persists it (AC-15)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'PC Agent 2', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [{ repo_id: repo.id, path: 'src/index.ts' }] },
    });
    expect(res.statusCode).toBe(422);

    const listed = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-docs` });
    expect(listed.json()).toEqual([]); // nothing persisted — all-or-nothing

    await app.close();
  });

  it('rejects (422) a path-traversal escape — never persists it (AC-15)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'PC Agent 3', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [{ repo_id: repo.id, path: '../../../../etc/passwd' }] },
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('rejects (422) a repo_id belonging to a different workspace (NFR access control)', async () => {
    const app = await appWith();
    const foreignRepo = await makeRepo(pg.handle.db, otherWorkspaceId, cloneA);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'PC Agent 4', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { docs: [{ repo_id: foreignRepo.id, path: 'specs/public-api.md' }] },
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('404s attach/detach for an agent not in the caller\'s workspace', async () => {
    const app = await appWith();
    // A fake UUID that doesn't correspond to any agent.
    const res = await app.inject({
      method: 'POST',
      url: '/agents/00000000-0000-0000-0000-000000000000/context-docs',
      payload: { docs: [] },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('attaches docs to a skill independently of any agent (AC-7)', async () => {
    const app = await appWith();
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'PC Skill', description: 'd', body: '# PC Skill' },
      })
    ).json();

    const set = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-docs`,
      payload: { docs: [{ repo_id: repo.id, path: 'specs/public-api.md' }] },
    });
    expect(set.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context-docs` });
    expect(listed.json()).toHaveLength(1);

    await app.close();
  });

  it(
    "resolveAgentContext: own docs first, then enabled linked skills' docs, " +
      'deduped on (repoId, path) keeping the agent-level occurrence (AC-9, AC-10)',
    async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId, cloneA);
      const repoB = await makeRepo(pg.handle.db, workspaceId, cloneB);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'PC Resolve Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'r' },
        })
      ).json();
      const enabledSkill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'PC Enabled Skill', description: 'd', body: '# x' },
        })
      ).json();
      const disabledSkill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'PC Disabled Skill', description: 'd', body: '# y', enabled: false },
        })
      ).json();

      // Agent's own doc: specs/public-api.md@repo (this one wins the dedup).
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context-docs`,
        payload: { docs: [{ repo_id: repo.id, path: 'specs/public-api.md' }] },
      });
      // Enabled skill: the SAME (repo, path) — must be deduped away — plus a
      // distinct doc from repoB that should still show up.
      await app.inject({
        method: 'POST',
        url: `/skills/${enabledSkill.id}/context-docs`,
        payload: {
          docs: [
            { repo_id: repo.id, path: 'specs/public-api.md' },
            { repo_id: repoB.id, path: 'docs/architecture.md' },
          ],
        },
      });
      // Disabled skill's doc must never appear.
      await app.inject({
        method: 'POST',
        url: `/skills/${disabledSkill.id}/context-docs`,
        payload: { docs: [{ repo_id: repoB.id, path: 'docs/architecture.md' }] },
      });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [enabledSkill.id, disabledSkill.id] },
      });

      const resolved = await app.container.projectContext.resolveAgentContext(agent.id);
      expect(resolved).toEqual([
        { repoId: repo.id, owner: 'acme', name: repo.name, path: 'specs/public-api.md' },
        { repoId: repoB.id, owner: 'acme', name: repoB.name, path: 'docs/architecture.md' },
      ]);

      await app.close();
    },
  );
});
