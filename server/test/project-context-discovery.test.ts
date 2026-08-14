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

  it('returns null when no ancestor directory or filename stem matches', () => {
    expect(categorizePath('src/index.ts')).toBeNull();
  });

  it('matches by filename stem too, case-insensitively — no directory ancestor required', () => {
    // This repo's own convention: root-level `INSIGHTS.md`/`server/INSIGHTS.md`
    // have no `insights/` ancestor DIRECTORY, just that name as the FILENAME.
    expect(categorizePath('INSIGHTS.md')).toBe('insights');
    expect(categorizePath('server/INSIGHTS.md')).toBe('insights');
    expect(categorizePath('specs.md')).toBe('specs');
    expect(categorizePath('Docs.md')).toBe('docs');
  });

  it('directory-ancestor match still wins over filename stem when both are present', () => {
    // "docs/insights.md" — the ancestor DIR (docs) takes priority over the
    // filename stem (insights).
    expect(categorizePath('docs/insights.md')).toBe('docs');
  });

  it('a filename that matches neither an ancestor nor a category stem is null', () => {
    expect(categorizePath('README.md')).toBeNull();
    expect(categorizePath('CHANGELOG.md')).toBeNull();
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

  it("includes .md files outside specs/docs/insights, categorized as 'other'", async () => {
    await writeFileAt(root, 'README.md', '# root readme');
    await writeFileAt(root, 'src/notes.md', '# a stray note');
    await writeFileAt(root, 'specs/public-api.md', '# yes');

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'README.md', category: 'other', chars: Buffer.byteLength('# root readme') },
      { path: 'specs/public-api.md', category: 'specs', chars: Buffer.byteLength('# yes') },
      { path: 'src/notes.md', category: 'other', chars: Buffer.byteLength('# a stray note') },
    ]);
  });

  it("finds a root-level INSIGHTS.md as category 'insights' — it has no insights/ ANCESTOR DIRECTORY, just that name as its filename, matched by categorizePath's filename-stem check", async () => {
    await writeFileAt(root, 'INSIGHTS.md', '# 2026-08-14 gotcha');
    await writeFileAt(root, 'server/INSIGHTS.md', '# server gotcha');

    const result = await discoverContextDocs(root);
    expect(result).toEqual([
      { path: 'INSIGHTS.md', category: 'insights', chars: Buffer.byteLength('# 2026-08-14 gotcha') },
      { path: 'server/INSIGHTS.md', category: 'insights', chars: Buffer.byteLength('# server gotcha') },
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
