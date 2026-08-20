import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

d('skills CRUD + import (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
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

  it('creates, lists, updates (body change bumps version), deletes', async () => {
    const app = await makeApp();

    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'PR Quality Rubric',
        description: 'Check for happy path + one edge case.',
        type: 'rubric',
        body: '# PR Quality Rubric\nCheck for happy path + one edge case.',
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.version).toBe(1);
    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === skill.id)).toBe(true);

    // description-only change does NOT bump version
    const patchedDesc = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { description: 'Updated description.' },
      })
    ).json();
    expect(patchedDesc.version).toBe(1);

    // body change DOES bump version
    const patchedBody = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { body: '# PR Quality Rubric\nAlso check for flaky assertions.' },
      })
    ).json();
    expect(patchedBody.version).toBe(2);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);
    const afterDelete = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(afterDelete.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a non-markdown import filename', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'skill.zip', content: '# Title\nBody.' },
    });
    // ValidationError (platform/errors.ts) carries statusCode 422, not 400 —
    // the app's global error handler maps every AppError to its own
    // statusCode, and "Validation → 422" is the established convention here
    // (see src/app.ts's setErrorHandler comment). The task brief's original
    // test asserted 400; confirmed against the actual ValidationError class
    // and corrected to 422 to match real behavior.
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('previews an import without persisting, then saves it disabled + imported_url', async () => {
    const app = await makeApp();

    const preview = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: {
        filename: 'api-contract-change.md',
        content: '# Api Contract Change\n\nFlag any exported route signature change without a version bump.',
      },
    });
    expect(preview.statusCode).toBe(200);
    const parsed = preview.json();
    expect(parsed.name).toBe('Api Contract Change');
    expect(parsed.description).toBe(
      'Flag any exported route signature change without a version bump.',
    );

    const before = (await app.inject({ method: 'GET', url: '/skills' })).json();

    const saved = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { name: parsed.name, description: parsed.description, body: parsed.body },
    });
    expect(saved.statusCode).toBe(201);
    const skill = saved.json();
    expect(skill.source).toBe('imported_url');
    expect(skill.enabled).toBe(false);

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(after.length).toBe(before.length + 1);

    await app.close();
  });

  it('GET /skills/:id/versions grows on each body-changing PUT, newest first (AC-28)', async () => {
    const app = await makeApp();

    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Versioned Skill',
          description: 'Tracks its own history.',
          body: '# v1',
        },
      })
    ).json();

    const v1 = await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject([{ skill_id: created.id, version: 1, body: '# v1' }]);

    // description-only change does NOT bump the version → no new snapshot.
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { description: 'Updated description.' },
    });
    const afterDescChange = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(afterDescChange).toHaveLength(1);

    // body change DOES bump the version → new snapshot, list is newest-first.
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: '# v2' },
    });
    const afterBodyChange = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(afterBodyChange.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(afterBodyChange[0]).toMatchObject({ skill_id: created.id, version: 2, body: '# v2' });
    expect(typeof afterBodyChange[0].created_at).toBe('string');

    await app.close();
  });

  it('GET /skills/:id/versions 404s on an unknown/foreign-workspace skill id (AC-32)', async () => {
    const app = await makeApp();

    // IdParams validates :id as a UUID before the handler runs — use a
    // UUID-shaped id that was never inserted (server INSIGHTS.md 2026-08-06).
    const unknown = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-0000-0000-000000000000/versions',
    });
    expect(unknown.statusCode).toBe(404);

    // A skill that genuinely exists, but in a DIFFERENT workspace — the
    // service must check workspace ownership BEFORE calling
    // repo.listVersions (AC-32), same idiom/precedent as
    // agents-versions.it.test.ts's cross-tenant case.
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Skill',
      description: 'Lives in another workspace.',
      type: 'custom',
      source: 'manual',
      body: '# foreign',
    });

    const foreignViaHttp = await app.inject({
      method: 'GET',
      url: `/skills/${foreign.id}/versions`,
    });
    expect(foreignViaHttp.statusCode).toBe(404);

    const service = new SkillsService({ db } as unknown as Container);
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    expect(await service.listVersions(otherWs!.id, foreign.id)).toHaveLength(1);
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();

    await app.close();
  });
});
