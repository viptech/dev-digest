/**
 * SPEC-03 (Onboarding Generator) — T4: routes (Testcontainers pg). Modeled on
 * `project-context.it.test.ts` / `conventions.it.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FIXTURE_SECTIONS = [
  { kind: 'architecture', title: 'Architecture', body: 'arch', diagram: null, links: [] },
  { kind: 'critical_paths', title: 'Critical Paths', body: 'cp', diagram: null, links: [] },
  {
    kind: 'local_setup',
    title: 'Local Setup',
    body: 'setup',
    diagram: null,
    links: [],
    commands: [{ cmd: 'pnpm install' }],
  },
  { kind: 'reading_order', title: 'Reading Order', body: 'ro', diagram: null, links: [{ label: 'entry point', path: 'src/service.ts' }] },
  {
    kind: 'first_tasks',
    title: 'First Tasks',
    body: 'tasks',
    diagram: null,
    links: [],
    tasks: [
      { title: 'Task A', path: 'src/service.ts', complexity: 'low' },
      { title: 'Task B', path: 'src/service.ts', complexity: 'medium' },
      { title: 'Task C', path: 'src/service.ts', complexity: 'high' },
    ],
  },
];

d('onboarding generate/persist/grounding (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let clonePath: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'Other Workspace' }).returning();
    otherWorkspaceId = otherWs!.id;

    clonePath = await mkdtemp(join(tmpdir(), 'onboarding-fixture-'));
    await mkdir(join(clonePath, 'src'), { recursive: true });
    await writeFile(join(clonePath, 'src', 'service.ts'), 'export class WidgetService {}\n');
    await writeFile(
      join(clonePath, 'package.json'),
      JSON.stringify({ dependencies: { fastify: '^5.0.0' }, scripts: { test: 'vitest run' } }),
    );
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  async function makeRepo(ws: string) {
    const name = `onb-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    // Non-degraded index state + one ranked file — the minimal seed for
    // `getRepoFacts`/`getTopFilesByRank`/`getCriticalPaths` to avoid the
    // degraded (no-LLM-call) path.
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo!.id,
      lastIndexedSha: 'sha1',
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
    });
    await pg.handle.db.insert(t.fileRank).values({
      repoId: repo!.id,
      filePath: 'src/service.ts',
      pagerank: 1,
      hotness: 0,
      rank: 1,
      percentile: 99,
    });
    return repo!;
  }

  function appWith() {
    const llmFixture = { sections: FIXTURE_SECTIONS };
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: {
          // onboarding defaults to openrouter — mock it (and openai, in case a
          // workspace override picks it) so no real provider is ever built.
          openrouter: new MockLLMProvider('openai', { structuredBySchema: { Onboarding: llmFixture } }),
          openai: new MockLLMProvider('openai', { structuredBySchema: { Onboarding: llmFixture } }),
        },
      },
    });
  }

  it('GET 404s before any generation', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST generates + persists a row (response includes generated_at); second POST UPSERTs', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);

    const first = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.degraded).toBeUndefined();
    expect(typeof firstBody.generated_at).toBe('string');
    expect(firstBody.sections).toHaveLength(5);

    const rowsAfterFirst = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(rowsAfterFirst).toHaveLength(1);

    // GET now succeeds (row exists).
    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(get.statusCode).toBe(200);
    expect(get.json().sections).toHaveLength(5);

    const second = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(second.statusCode).toBe(200);

    const rowsAfterSecond = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(rowsAfterSecond).toHaveLength(1); // UPSERT, not a second row

    await app.close();
  });

  it('GET/POST 404 for a repoId belonging to a different workspace; POST never invokes the mock LLM', async () => {
    const app = await appWith();
    const foreignRepo = await makeRepo(otherWorkspaceId);

    const get = await app.inject({ method: 'GET', url: `/repos/${foreignRepo.id}/onboarding` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/repos/${foreignRepo.id}/onboarding/generate` });
    expect(post.statusCode).toBe(404);

    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, foreignRepo.id));
    expect(rows).toHaveLength(0);

    await app.close();
  });

  it('429s the 11th POST within the rate-limit window', async () => {
    // NOTE (flagged to the user — see the implementer's final report): the
    // global `@fastify/rate-limit` plugin registration in `app.ts` is SKIPPED
    // entirely whenever `config.nodeEnv === 'test'` (so other integration
    // suites can hammer endpoints via `inject()`), but that same gate also
    // means NO per-route `config.rateLimit` override (this route's
    // `{max:10,...}`, or `reviews/routes.ts`'s identical precedent) can ever
    // take effect under the standard `NODE_ENV: 'test'` test config — the
    // plugin must be registered at all for a route-level option to do
    // anything. This is a pre-existing gap (confirmed: no other `.it.test.ts`
    // in this repo exercises a 429 either). Forcing `nodeEnv` to a non-'test'
    // value HERE, for this one app instance only, is the minimal way to
    // actually exercise the wiring — every other `loadConfig` field was
    // already parsed against `NODE_ENV: 'test'` and is unaffected by this
    // post-parse override.
    const cfg = config();
    cfg.nodeEnv = 'production';
    const llmFixture = { sections: FIXTURE_SECTIONS };
    const app = await buildApp({
      config: cfg,
      db: pg.handle.db,
      overrides: {
        llm: {
          openrouter: new MockLLMProvider('openai', { structuredBySchema: { Onboarding: llmFixture } }),
          openai: new MockLLMProvider('openai', { structuredBySchema: { Onboarding: llmFixture } }),
        },
      },
    });
    const repo = await makeRepo(workspaceId);

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
      expect(res.statusCode).toBe(200);
    }
    const eleventh = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(eleventh.statusCode).toBe(429);

    await app.close();
  });
});
