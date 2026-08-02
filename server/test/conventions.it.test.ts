import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const EXTRACTION = {
  candidates: [
    {
      rule: 'Services are named `<Domain>Service` and take a Container in the constructor.',
      evidence_path: 'src/service.ts',
      evidence_snippet: 'export class WidgetService { constructor(private container: Container) {} }',
      confidence: 0.9,
    },
  ],
};

d('conventions extraction (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = mkdtempSync(join(tmpdir(), 'conv-fixture-'));
    // File lives at "src/service.ts" relative to the clone root — matches the
    // path used in file_rank, the mocked file-selection response, and the
    // mocked extraction's evidence_path. readClone() joins clonePath + this
    // relative path, so the on-disk layout must mirror it exactly.
    mkdirSync(join(clonePath, 'src'), { recursive: true });
    writeFileSync(
      join(clonePath, 'src', 'service.ts'),
      'export class WidgetService {\n  constructor(private container: Container) {}\n}\n',
    );
  });
  afterAll(async () => {
    await pg?.stop();
    rmSync(clonePath, { recursive: true, force: true });
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              ConventionFileSelection: { files: ['src/service.ts'] },
              ConventionExtraction: EXTRACTION,
            },
          }),
        },
      },
    });
  }

  it('extracts candidates, lists them, accepts one, re-extract preserves the accepted one', async () => {
    const app = await appWith();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-repo', fullName: 'acme/conv-repo', clonePath })
      .returning();
    // Seed one ranked file so getConventionSamples returns something.
    await pg.handle.db.insert(t.fileRank).values({
      repoId: repo!.id,
      filePath: 'src/service.ts',
      pagerank: 1,
      hotness: 0,
      rank: 1,
      percentile: 99,
    });

    const extracted = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
    });
    expect(extracted.statusCode).toBe(200);
    const candidates = extracted.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence_snippet).toContain('WidgetService');
    expect(candidates[0].accepted).toBe(false);

    const accept = await app.inject({
      method: 'PUT',
      url: `/conventions/${candidates[0].id}`,
      payload: { accepted: true },
    });
    expect(accept.json().accepted).toBe(true);

    // re-extract: the accepted one survives (deleteUnaccepted only removes accepted=false rows)
    await app.inject({ method: 'POST', url: `/repos/${repo!.id}/conventions/extract` });
    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repo!.id}/conventions` })
    ).json();
    expect(after.filter((c: { accepted: boolean }) => c.accepted)).toHaveLength(1);

    await app.close();
  });
});
