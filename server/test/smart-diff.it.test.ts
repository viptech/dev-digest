/**
 * GET /pulls/:id/smart-diff — groups an already-imported PR's files by risk
 * role, joining in the latest review's findings. Purely deterministic (no
 * LLM call, no `overrides.llm` mock needed here — that omission is itself
 * part of the acceptance criterion). Gated on Docker, matching the other
 * integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 42,
      title: 'Add payments retry logic',
      author: 'marisa.koch',
      branch: 'feat/retry',
      base: 'main',
      headSha: 'cafefeed',
      additions: 30,
      deletions: 5,
      filesCount: 3,
      status: 'open',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'package-lock.json', additions: 900, deletions: 800, patch: null },
    { prId: pr!.id, path: 'src/index.ts', additions: 3, deletions: 0, patch: null },
    { prId: pr!.id, path: 'src/payments/retry.ts', additions: 20, deletions: 5, patch: null },
  ]);
  return { repo: repo!, pr: pr! };
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('before any review: all files present, lock file in boilerplate, finding_lines all empty', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    const boilerplate = body.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplate?.files.map((f) => f.path)).toContain('package-lock.json');

    const core = body.groups.find((g) => g.role === 'core');
    expect(core?.files.map((f) => f.path)).toContain('src/payments/retry.ts');

    const wiring = body.groups.find((g) => g.role === 'wiring');
    expect(wiring?.files.map((f) => f.path)).toContain('src/index.ts');

    for (const group of body.groups) {
      for (const f of group.files) {
        expect(f.finding_lines).toEqual([]);
        expect(f.pseudocode_summary).toBeNull();
      }
    }
  });

  it('after a review with findings: the matching file shows non-empty finding_lines', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'Needs a retry cap',
        score: 62,
      })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'src/payments/retry.ts',
      startLine: 18,
      endLine: 20,
      severity: 'WARNING',
      category: 'bug',
      title: 'Unbounded retry loop',
      rationale: 'No max-attempts guard.',
      confidence: 0.8,
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    const core = body.groups.find((g) => g.role === 'core');
    const retryFile = core?.files.find((f) => f.path === 'src/payments/retry.ts');
    expect(retryFile?.finding_lines).toEqual([18]);

    const boilerplate = body.groups.find((g) => g.role === 'boilerplate');
    const lockFile = boilerplate?.files.find((f) => f.path === 'package-lock.json');
    expect(lockFile?.finding_lines).toEqual([]);
  });

  it('404s for an unknown/foreign-workspace PR id', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/smart-diff`,
    });
    expect(res.statusCode).toBe(404);
  });
});
