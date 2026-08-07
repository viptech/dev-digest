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

// Fixture file (written below) is:
//   1: export class WidgetService {
//   2:   constructor(private container: Container) {}
//   3: }
// — 'WidgetService' is on line 1, so evidence_line: 1 is a real, verifiable line.
const EXTRACTION = {
  candidates: [
    {
      category: 'naming',
      rule: 'Services are named `<Domain>Service` and take a Container in the constructor.',
      evidence_path: 'src/service.ts',
      evidence_line: 1,
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
          // conventions defaults to openrouter (cheap flash-class model, no
          // OpenAI key required) — mock it too, independent of which provider
          // a given test cares about, or extraction falls through to a REAL
          // provider construction.
          openrouter: new MockLLMProvider('openrouter', {
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

    // Empty-object payload (rather than omitting payload entirely): fastify's
    // light-my-request `inject()` sends a `null` body when no payload is
    // given at all, which fails the zod `body.optional()` check (it expects
    // `undefined`, not `null`) — `{}` sidesteps that inject-only quirk.
    const extracted = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
      payload: {},
    });
    expect(extracted.statusCode).toBe(200);
    const candidates = extracted.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence_snippet).toContain('WidgetService');
    expect(candidates[0].accepted).toBe(false);

    const accept = await app.inject({
      method: 'PUT',
      url: `/conventions/${candidates[0].id}`,
      payload: { status: 'accepted' },
    });
    expect(accept.json().accepted).toBe(true);

    // re-extract: the accepted one survives (deleteUnaccepted only removes accepted=false rows)
    await app.inject({ method: 'POST', url: `/repos/${repo!.id}/conventions/extract`, payload: {} });
    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repo!.id}/conventions` })
    ).json();
    expect(after.filter((c: { accepted: boolean }) => c.accepted)).toHaveLength(1);

    await app.close();
  });

  it('drops candidates whose evidence_line is out of range', async () => {
    const extractionWithBadLine = {
      candidates: [
        EXTRACTION.candidates[0],
        {
          category: 'naming',
          rule: 'A rule whose cited evidence line does not exist in the file.',
          evidence_path: 'src/service.ts',
          evidence_line: 9999,
          evidence_snippet: 'this line does not exist',
          confidence: 0.9,
        },
      ],
    };
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              ConventionFileSelection: { files: ['src/service.ts'] },
              ConventionExtraction: extractionWithBadLine,
            },
          }),
          // conventions defaults to openrouter — mock it too (see appWith()).
          openrouter: new MockLLMProvider('openrouter', {
            structuredBySchema: {
              ConventionFileSelection: { files: ['src/service.ts'] },
              ConventionExtraction: extractionWithBadLine,
            },
          }),
        },
      },
    });

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-repo-oob', fullName: 'acme/conv-repo-oob', clonePath })
      .returning();
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
      payload: {},
    });
    expect(extracted.statusCode).toBe(200);
    const candidates = extracted.json();
    // The out-of-range evidence_line candidate must be dropped by verifyEvidence.
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence_line).toBe(1);

    await app.close();
  });

  it('sampling_mode: "llm" runs the 2-step file-selection flow', async () => {
    const app = await appWith();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-repo-llm', fullName: 'acme/conv-repo-llm', clonePath })
      .returning();
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
      payload: { sampling_mode: 'llm' },
    });
    expect(extracted.statusCode).toBe(200);
    const candidates = extracted.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence_snippet).toContain('WidgetService');

    await app.close();
  });
});
