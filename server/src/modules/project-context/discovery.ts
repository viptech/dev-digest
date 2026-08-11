/**
 * Project Context (SPEC-01) — markdown discovery. A NEW, lightweight,
 * DB-free walk — deliberately NOT an extension of the code-indexing
 * `repo-intel/pipeline/walk.ts` (`walkClone`), which is scoped to
 * `SUPPORTED_EXT` code files for the AST-parsing pipeline. This walk only
 * ever looks for `.md` files under `specs/`, `docs/`, or `insights/`
 * directories (AC-1), at any depth, matching the glob
 * `**\/{specs,docs,insights}/**\/*.md`.
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

export type ProjectContextCategory = 'specs' | 'docs' | 'insights';
const CATEGORIES: ReadonlySet<string> = new Set(['specs', 'docs', 'insights']);

/**
 * Category of a discovered `.md` file: the rightmost (closest to the file)
 * directory segment among `specs`/`docs`/`insights` in its repo-relative
 * path, or `null` if none of its ancestor directories match. Pure —
 * a plain string-shape check, no FS access — so both `discoverContextDocs`
 * and the attach-time/read-time AC-15 "under one of the configured roots"
 * checks in `service.ts` can reuse it without duplicating the rule.
 */
export function categorizePath(path: string): ProjectContextCategory | null {
  const segments = path.split('/');
  segments.pop(); // drop the filename itself — only directory ancestors count
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment !== undefined && CATEGORIES.has(segment)) {
      return segment as ProjectContextCategory;
    }
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
 * Recursively walk `clonePath`, returning every `.md` file whose path has
 * `specs`/`docs`/`insights` as an ancestor directory. Never throws — a
 * missing/unreadable clone root (or any subdirectory) degrades to `[]`/skips
 * that branch, same contract as `walkClone` (AC-3).
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
    const category = categorizePath(rel);
    if (!category) continue; // no specs/docs/insights ancestor — out of scope

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
