/**
 * Project Context — markdown discovery. A NEW, lightweight, DB-free walk —
 * deliberately NOT an extension of the code-indexing `repo-intel/pipeline/
 * walk.ts` (`walkClone`), which is scoped to `SUPPORTED_EXT` code files for
 * the AST-parsing pipeline. This walk finds EVERY `.md` file anywhere in the
 * clone (not just under `specs/`/`docs`/`insights/` — SPEC-01's original,
 * fixed-root scope was too narrow in practice: files like this very repo's
 * own root-level `INSIGHTS.md`/`server/INSIGHTS.md` have no `insights/`
 * ANCESTOR DIRECTORY at all, just that name as the FILENAME, so the old
 * `**\/{specs,docs,insights}/**\/*.md` glob silently never surfaced them —
 * `categorizePath` now also matches a file's own FILENAME stem, so
 * `INSIGHTS.md` gets `category: 'insights'` wherever it sits). A doc under
 * one of the three configured roots (by directory ancestor OR filename
 * stem) keeps that category label; every other `.md` file gets
 * `category: 'other'`.
 *
 * Best-effort, like every other repo-intel-adjacent read: an unreadable or
 * missing root directory degrades to `[]`, mirroring `walkDir`'s
 * `catch { return; }` in `repo-intel/pipeline/walk.ts` (AC-3).
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

/** The three originally-configured discovery-root categories a path's
 *  ancestor directory can match. */
export type ConfiguredRootCategory = 'specs' | 'docs' | 'insights';
const CATEGORIES: ReadonlySet<string> = new Set(['specs', 'docs', 'insights']);

/** Every category a discovered doc can carry: the three configured roots,
 *  plus `'other'` for any `.md` file elsewhere in the repo. */
export type ProjectContextCategory = ConfiguredRootCategory | 'other';

/**
 * Category of a discovered `.md` file — checked two ways, directory match
 * taking priority:
 * 1. The rightmost (closest to the file) directory segment among
 *    `specs`/`docs`/`insights` in its repo-relative path.
 * 2. Its own FILENAME stem (case-insensitive, `.md` stripped) — this repo's
 *    own convention is exactly this: root-level `INSIGHTS.md`,
 *    `server/INSIGHTS.md`, `client/INSIGHTS.md`, etc. are all named
 *    `INSIGHTS.md` sitting directly in a package root, with no `insights/`
 *    ancestor DIRECTORY at all — the filename itself IS the signal.
 *
 * `null` when neither matches. Pure — a plain string-shape check, no FS
 * access — so both `discoverContextDocs` (which falls back to `'other'`
 * when this returns `null`) and any future root-aware labeling can reuse
 * it without duplicating the rule.
 */
export function categorizePath(path: string): ConfiguredRootCategory | null {
  const segments = path.split('/');
  const filename = segments.pop(); // drop the filename itself for the dir-ancestor pass
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment !== undefined && CATEGORIES.has(segment)) {
      return segment as ConfiguredRootCategory;
    }
  }
  if (filename) {
    const stem = filename.replace(/\.md$/i, '').toLowerCase();
    if (CATEGORIES.has(stem)) return stem as ConfiguredRootCategory;
  }
  return null;
}

export interface DiscoveredDoc {
  path: string;
  category: ProjectContextCategory;
  /** Byte size (stat, not a content read) — a close-enough proxy for the
   *  UI's live `ceil(chars/4)` token estimate (AC-5); never used for the
   *  actual run-time injection cap, which measures the real read content. */
  chars: number;
}

/**
 * Recursively walk `clonePath`, returning EVERY `.md` file in the clone
 * (`EXCLUDED_DIRS` subtrees skipped, same as the code-indexing walker).
 * Never throws — a missing/unreadable clone root (or any subdirectory)
 * degrades to `[]`/skips that branch, same contract as `walkClone` (AC-3).
 */
export async function discoverContextDocs(clonePath: string): Promise<DiscoveredDoc[]> {
  const out: DiscoveredDoc[] = [];
  await walkForMarkdown(clonePath, clonePath, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walkForMarkdown(root: string, dir: string, out: DiscoveredDoc[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink, missing clone) —
    // skip cleanly, same as walkClone's degrade contract.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(entry.name)) continue;
      await walkForMarkdown(root, join(dir, entry.name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (extname(entry.name).toLowerCase() !== '.md') continue;

    const rel = relative(root, join(dir, entry.name)).split(sep).join('/');
    // Every `.md` file counts now — categorized when it's under one of the
    // three original roots, `'other'` otherwise (see module doc-comment).
    const category: ProjectContextCategory = categorizePath(rel) ?? 'other';

    const full = join(dir, entry.name);
    let chars = 0;
    try {
      chars = (await stat(full)).size;
    } catch {
      // Vanished between readdir and stat — skip, same best-effort contract.
      continue;
    }

    out.push({ path: rel, category, chars });
  }
}
