/**
 * T3 (onboarding) — `RepoIntelService.getRepoFacts` (SPEC-03 Step 1).
 *
 * Hermetic: no Postgres, no Docker. Modeled on `repo-intel-facade-degraded.test.ts`'s
 * pattern of patching the service's private `repo` (RepoIntelRepository) directly,
 * combined with a REAL temp clone directory on disk so `readFiles`/`readClone`
 * (unmodified) exercise real file reads, same as `conventions.it.test.ts`'s fixture
 * clone convention.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { Container } from '../src/platform/container.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { IndexerFileFactsRow } from '../src/modules/repo-intel/repository.js';

const REPO_ID = 'r1';

function nonDegradedState(): IndexState {
  return {
    repoId: REPO_ID,
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date(),
  };
}

interface BuildOpts {
  clonePath: string | null;
  indexState: IndexState;
  fileFacts?: IndexerFileFactsRow[];
  rankedPaths?: { path: string; rank: number }[];
}

function buildService(opts: BuildOpts): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as unknown as Container;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () =>
      opts.clonePath
        ? { id: REPO_ID, owner: 'acme', name: 'widget', defaultBranch: 'main', clonePath: opts.clonePath }
        : null,
    tryGetIndexState: async () => opts.indexState,
    getAllFileFacts: async () => opts.fileFacts ?? [],
    getRankedPaths: async () => opts.rankedPaths ?? [],
  };
  return svc;
}

describe('RepoIntelService.getRepoFacts', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function makeClone(): string {
    const dir = mkdtempSync(join(tmpdir(), 'repo-facts-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('happy path: all five fact categories populated from a fixture clone; routes from seeded file_facts', async () => {
    const clonePath = makeClone();
    writeFileSync(
      join(clonePath, 'package.json'),
      JSON.stringify({
        dependencies: { fastify: '^5.0.0', zod: '^3.24.0' },
        devDependencies: { vitest: '^2.1.0' },
        scripts: { build: 'tsc', dev: 'tsx watch src/server.ts', test: 'vitest run' },
      }),
    );
    writeFileSync(join(clonePath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    writeFileSync(join(clonePath, '.env.example'), 'DATABASE_URL=\nOPENAI_API_KEY=sk-xxx\n# comment\n');
    writeFileSync(
      join(clonePath, 'docker-compose.yml'),
      'services:\n  postgres:\n    image: pgvector/pgvector:pg16\n  redis:\n    image: redis:7\nnetworks:\n  default:\n',
    );

    const svc = buildService({
      clonePath,
      indexState: nonDegradedState(),
      fileFacts: [
        { filePath: 'src/routes/a.ts', endpoints: ['GET /a'], crons: [] },
        { filePath: 'src/routes/b.ts', endpoints: ['POST /b', 'GET /a'], crons: [] },
      ],
    });

    const facts = await svc.getRepoFacts(REPO_ID);

    expect(facts.degraded).toBeUndefined();
    expect(facts.packageManager).toBe('pnpm');
    expect(facts.dependencies.sort()).toEqual(['fastify', 'zod']);
    expect(facts.devDependencies).toEqual(['vitest']);
    expect(facts.envVarNames).toEqual(['DATABASE_URL', 'OPENAI_API_KEY']);
    expect(facts.dockerServices).toEqual(['postgres', 'redis']);
    // deduped ("GET /a" appears in both rows), and NOT re-derived from content
    // (no routes/*.ts source was ever written to disk for a fresh scan to find).
    expect([...facts.routes].sort()).toEqual(['GET /a', 'POST /b']);
  });

  it('scripts preserve package.json key order (no reordering at this layer)', async () => {
    const clonePath = makeClone();
    writeFileSync(
      join(clonePath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc', dev: 'tsx watch src/server.ts' } }),
    );
    const svc = buildService({ clonePath, indexState: nonDegradedState() });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.scripts.map((s) => s.name)).toEqual(['test', 'build', 'dev']);
  });

  it('routes FALLBACK: file_facts empty → bounded per-file extractEndpoints over ranked paths', async () => {
    const clonePath = makeClone();
    mkdirSync(join(clonePath, 'src'), { recursive: true });
    writeFileSync(
      join(clonePath, 'src', 'routes.ts'),
      "app.get('/health', handler);\napp.post('/widgets', create);\n",
    );
    const svc = buildService({
      clonePath,
      indexState: nonDegradedState(),
      fileFacts: [], // empty → triggers fallback
      rankedPaths: [{ path: 'src/routes.ts', rank: 5 }],
    });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.routes.sort()).toEqual(['GET /health', 'POST /widgets']);
  });

  it('missing package.json (non-Node repo) → un-degraded, empty stack facts', async () => {
    const clonePath = makeClone();
    writeFileSync(join(clonePath, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres\n');
    const svc = buildService({ clonePath, indexState: nonDegradedState() });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.degraded).toBeUndefined();
    expect(facts.packageManager).toBeNull();
    expect(facts.dependencies).toEqual([]);
    expect(facts.devDependencies).toEqual([]);
    expect(facts.scripts).toEqual([]);
    expect(facts.dockerServices).toEqual(['db']);
  });

  it('missing .env.example → empty envVarNames only, rest un-degraded', async () => {
    const clonePath = makeClone();
    writeFileSync(join(clonePath, 'package.json'), JSON.stringify({ dependencies: { fastify: '1' } }));
    const svc = buildService({ clonePath, indexState: nonDegradedState() });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.degraded).toBeUndefined();
    expect(facts.envVarNames).toEqual([]);
    expect(facts.dependencies).toEqual(['fastify']);
  });

  it('missing docker-compose.yml → empty dockerServices only, rest un-degraded', async () => {
    const clonePath = makeClone();
    writeFileSync(join(clonePath, 'package.json'), JSON.stringify({ dependencies: { fastify: '1' } }));
    const svc = buildService({ clonePath, indexState: nonDegradedState() });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.degraded).toBeUndefined();
    expect(facts.dockerServices).toEqual([]);
  });

  it('degraded-index passthrough: propagates degradedReason', async () => {
    const clonePath = makeClone();
    writeFileSync(join(clonePath, 'package.json'), JSON.stringify({ dependencies: {} }));
    const degradedState: IndexState = {
      ...nonDegradedState(),
      status: 'degraded',
      degraded: true,
      degradedReason: 'index_partial',
    };
    const svc = buildService({ clonePath, indexState: degradedState });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.degraded).toBe(true);
    expect(facts.reason).toBe('index_partial');
  });

  it('no clone + zero indexed files at all → degrades with no_data', async () => {
    const svc = buildService({
      clonePath: null,
      indexState: { ...nonDegradedState(), filesIndexed: 0 },
    });
    const facts = await svc.getRepoFacts(REPO_ID);
    expect(facts.degraded).toBe(true);
    expect(facts.reason).toBe('no_data');
  });
});
