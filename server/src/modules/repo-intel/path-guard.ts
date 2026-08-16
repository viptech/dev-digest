import { resolve, sep } from 'node:path';

/**
 * Resolve a repo-relative path against a clone directory, rejecting any
 * escape outside it (`../`, an absolute path, symlink-free path-string
 * tricks). Returns the resolved absolute path, or `null` if it would land
 * outside `clonePath`.
 *
 * Extracted so both `readClone()` (generic — every existing caller of
 * `RepoIntelService.readFiles` gets this for free, e.g.
 * `intent-service.ts`'s plan-spec lookup, which resolves an untrusted,
 * PR-body-derived path) and the `project-context` module's attach-time/
 * read-time AC-15 guard (SPEC-01) can share the exact same resolve logic
 * instead of reimplementing it twice. This is only the "stays inside the
 * clone dir" half of AC-15 — the "AND under one of specs/docs/insights"
 * half is project-context-specific and lives in that module instead.
 */
export function resolveInClone(clonePath: string, relPath: string): string | null {
  const base = resolve(clonePath);
  const resolved = resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;
  return resolved;
}
