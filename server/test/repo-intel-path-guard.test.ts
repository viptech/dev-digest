/**
 * SPEC-01 (Project Context) — AC-15's generic half: `readClone()`/`readFiles()`
 * must reject any path that would resolve outside the repo's clone directory.
 *
 * No Postgres, no git clone. Builds a real temp directory on disk (so the
 * resolve/prefix check runs against a real filesystem, not a mock), patches
 * the service's `repo` field directly (same trick as
 * `repo-intel-facade-degraded.test.ts` / `conventions-file-guard.test.ts`,
 * per `server/INSIGHTS.md` 2026-08-02) to avoid needing Container/DI wiring.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { resolveInClone } from '../src/modules/repo-intel/path-guard.js';
import type { RepoBasics } from '../src/modules/repo-intel/repository.js';

function buildServiceForClone(clonePath: string | null): RepoIntelService {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  const basics: RepoBasics = {
    id: 'repo-1',
    owner: 'acme',
    name: 'payments-api',
    defaultBranch: 'main',
    clonePath,
  };
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => basics,
  };
  return svc;
}

describe('resolveInClone', () => {
  it('resolves a legitimate nested relative path inside the clone dir', () => {
    const resolved = resolveInClone('/tmp/clone-x', 'specs/public-api.md');
    expect(resolved).toBe(join('/tmp/clone-x', 'specs/public-api.md'));
  });

  it('rejects a `../` escape', () => {
    expect(resolveInClone('/tmp/clone-x', '../../../../etc/passwd')).toBeNull();
  });

  it('rejects an absolute path outside the clone dir', () => {
    expect(resolveInClone('/tmp/clone-x', '/etc/passwd')).toBeNull();
  });

  it('accepts the clone root itself', () => {
    expect(resolveInClone('/tmp/clone-x', '.')).toBe(join('/tmp/clone-x'));
  });
});

describe('RepoIntelService.readFiles — traversal guard (AC-15)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'repo-intel-path-guard-'));
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'public-api.md'), '# Public API\ncontent');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a legitimate nested relative path', async () => {
    const svc = buildServiceForClone(root);
    const result = await svc.readFiles('repo-1', ['specs/public-api.md']);
    expect(result).toEqual([
      { path: 'specs/public-api.md', content: '# Public API\ncontent' },
    ]);
  });

  it('rejects a `../` escape — resolves to [] instead of throwing', async () => {
    const svc = buildServiceForClone(root);
    const result = await svc.readFiles('repo-1', ['../../../../etc/passwd']);
    expect(result).toEqual([]);
  });

  it('rejects an absolute path — resolves to [] instead of throwing', async () => {
    const svc = buildServiceForClone(root);
    const result = await svc.readFiles('repo-1', ['/etc/passwd']);
    expect(result).toEqual([]);
  });

  it('mixed request: legitimate path still resolves, escape path is dropped', async () => {
    const svc = buildServiceForClone(root);
    const result = await svc.readFiles('repo-1', [
      'specs/public-api.md',
      '../../../../etc/passwd',
    ]);
    expect(result).toEqual([
      { path: 'specs/public-api.md', content: '# Public API\ncontent' },
    ]);
  });

  it('degrades to [] when the repo has no clonePath, without throwing', async () => {
    const svc = buildServiceForClone(null);
    const result = await svc.readFiles('repo-1', ['specs/public-api.md']);
    expect(result).toEqual([]);
  });
});
