/**
 * SPEC-01 (Project Context) — T2: markdown discovery. No DB, no git — real
 * temp directory on disk, same pattern as `indexer-walk.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categorizePath, discoverContextDocs } from '../src/modules/project-context/discovery.js';
import { EXCLUDED_DIRS } from '../src/modules/repo-intel/constants.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('categorizePath', () => {
  it('categorizes by the rightmost matching ancestor directory', () => {
    expect(categorizePath('specs/public-api.md')).toBe('specs');
    expect(categorizePath('docs/architecture.md')).toBe('docs');
    expect(categorizePath('insights/2026-08.md')).toBe('insights');
  });

  it('matches at any depth', () => {
    expect(categorizePath('a/b/specs/c/public-api.md')).toBe('specs');
  });

  it('uses the rightmost segment when specs/docs/insights nest', () => {
    // "docs/specs/foo.md" — closest-to-file match wins (specs, not docs).
    expect(categorizePath('docs/specs/foo.md')).toBe('specs');
  });

  it('returns null when no ancestor matches', () => {
    expect(categorizePath('src/index.ts')).toBeNull();
    expect(categorizePath('README.md')).toBeNull();
  });

  it('does not match the filename itself, only directory ancestors', () => {
    // A file literally named "specs.md" at the root has no "specs" ancestor DIR.
    expect(categorizePath('specs.md')).toBeNull();
  });
});

describe('discoverContextDocs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-discovery-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds .md files under specs/, docs/, insights/ at any depth, with a byte-size chars field', async () => {
    await writeFileAt(root, 'specs/public-api.md', '# Public API');
    await writeFileAt(root, 'docs/architecture.md', '# Architecture');
    await writeFileAt(root, 'insights/nested/2026-08.md', '# Insight');

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'docs/architecture.md', category: 'docs', chars: Buffer.byteLength('# Architecture') },
      {
        path: 'insights/nested/2026-08.md',
        category: 'insights',
        chars: Buffer.byteLength('# Insight'),
      },
      { path: 'specs/public-api.md', category: 'specs', chars: Buffer.byteLength('# Public API') },
    ]);
  });

  it('ignores .md files outside specs/docs/insights', async () => {
    await writeFileAt(root, 'README.md', '# nope');
    await writeFileAt(root, 'src/notes.md', '# nope either');
    await writeFileAt(root, 'specs/public-api.md', '# yes');

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'specs/public-api.md', category: 'specs', chars: Buffer.byteLength('# yes') },
    ]);
  });

  it('ignores non-.md files even inside specs/docs/insights', async () => {
    await writeFileAt(root, 'specs/public-api.json', '{}');
    await writeFileAt(root, 'specs/public-api.md', '# yes');

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'specs/public-api.md', category: 'specs', chars: Buffer.byteLength('# yes') },
    ]);
  });

  it('skips EXCLUDED_DIRS (node_modules, dist, .git, etc.)', async () => {
    await writeFileAt(root, 'specs/public-api.md', '# yes');
    for (const d of EXCLUDED_DIRS) {
      await writeFileAt(root, `${d}/specs/inside.md`, '# no');
    }

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'specs/public-api.md', category: 'specs', chars: Buffer.byteLength('# yes') },
    ]);
  });

  it('degrades to [] for a missing/unreadable root, never throws', async () => {
    const missing = join(root, 'does-not-exist');
    await expect(discoverContextDocs(missing)).resolves.toEqual([]);
  });

  it('returns [] for an empty clone', async () => {
    await expect(discoverContextDocs(root)).resolves.toEqual([]);
  });
});
