import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

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
});
