/**
 * GET /pulls/:id/blast — persistent-index blast radius, end-to-end through
 * real Postgres. Seeded via `RepoIntelRepository`'s real insert/replace
 * methods (never hand-written SQL) — template `smart-diff.it.test.ts`'s
 * scaffold. Docker-gated, self-skips without it.
 *
 * Covers the same 2-hop endpoint case the fixes in `repo-intel/service.ts`
 * target (`repo-intel-blast-fixes.test.ts` proves the logic in isolation;
 * this proves it survives the real DB + HTTP route), plus the `status:
 * 'partial'` -> `degraded: true` passthrough.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { BlastRadius } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Refactor sharedHelper',
      author: 'marisa.koch',
      branch: 'feat/refactor',
      base: 'main',
      headSha: 'cafefeed',
      additions: 5,
      deletions: 1,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db.insert(t.prFiles).values([{ prId: pr!.id, path: 'src/helper.ts', additions: 5, deletions: 1, patch: null }]);
  return { repo: repo!, pr: pr! };
}

/**
 * routeFile -> serviceFile -> helper.ts (2 hops): only `service.ts` directly
 * calls `sharedHelper`; only `route.ts` has an HTTP endpoint. A correct 2-hop
 * reverse-import walk from the changed file (`helper.ts`) must still surface
 * `GET /widgets`.
 */
async function seedIndex(repo: RepoIntelRepository, repoId: string, status: 'full' | 'partial') {
  await repo.insertSymbols([
    {
      repoId,
      path: 'src/helper.ts',
      name: 'sharedHelper',
      kind: 'function',
      line: 1,
      endLine: 3,
      exported: true,
      signature: 'function sharedHelper()',
      contentHash: 'h1',
    },
  ]);
  await repo.insertReferences([
    { repoId, fromPath: 'src/service.ts', toSymbol: 'sharedHelper', line: 10, contentHash: 'h2' },
  ]);
  await repo.replaceEdges(repoId, [
    { fromFile: 'src/service.ts', toFile: 'src/helper.ts' },
    { fromFile: 'src/route.ts', toFile: 'src/service.ts' },
  ]);
  await repo.replaceFileFacts(repoId, [{ filePath: 'src/route.ts', endpoints: ['GET /widgets'], crons: [] }]);
  // `getResolvedCallers` inner-joins `file_rank` — every file needs a rank row
  // or it's silently excluded (repo-intel/INSIGHTS.md-worthy gotcha).
  await repo.replaceFileRank(repoId, [
    { filePath: 'src/helper.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 50 },
    { filePath: 'src/service.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 50 },
    { filePath: 'src/route.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 50 },
  ]);
  await repo.resolveReferences(repoId, { reset: false });
  await repo.upsertIndexState({
    repoId,
    lastIndexedSha: 'cafefeed',
    indexerVersion: INDEXER_VERSION,
    status,
    filesIndexed: 3,
    filesSkipped: 0,
    stats: {},
  });
}

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoRepo: RepoIntelRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repoRepo = new RepoIntelRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('2-hop case: routeFile -> serviceFile -> helper.ts — the endpoint surfaces through the whole route', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(repoRepo, repo.id, 'full');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;

    expect(body.changed_symbols).toEqual([{ file: 'src/helper.ts', name: 'sharedHelper', kind: 'function' }]);
    expect(body.downstream).toHaveLength(1);
    const impact = body.downstream[0]!;
    expect(impact.symbol).toBe('sharedHelper');
    expect(impact.callers.map((c) => c.file)).toContain('src/service.ts');
    // Would fail pre-fix: old code only unioned file_facts for the DIRECT
    // caller file (service.ts), never reaching route.ts (2 hops away).
    expect(impact.endpoints_affected).toContain('GET /widgets');
    expect(body.degraded).toBe(false);
  });

  it("status:'partial' -> degraded:true, reason:'index_partial' through the whole route", async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(repoRepo, repo.id, 'partial');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('index_partial');
  });

  it('404s for an unknown/foreign-workspace PR id', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/blast`,
    });
    expect(res.statusCode).toBe(404);
  });
});
