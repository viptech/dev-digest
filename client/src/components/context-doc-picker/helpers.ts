/** Move an item within an ordered array by index (drag-reorder helper) —
 *  same shape as AgentEditor's SkillsTab/helpers.ts `reorder`, generic here
 *  since the picker reorders {repo_id, path} entries, not skill ids. */
export function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Distinct repo ids, insertion order preserved (Set dedup + spread). */
export function distinctRepoIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/**
 * Client-side mirror of `server/src/modules/project-context/discovery.ts`'s
 * `categorizePath` — the rightmost (closest to the file) directory segment
 * among `specs`/`docs`/`insights` in a repo-relative path. Display-only
 * here (AC-4a's category badge on the "currently attached" list, which
 * only carries `{repo_id, path, order, owner, name}` — no `category` field,
 * since category is a pure function of the path, not separate state worth
 * persisting or round-tripping through a new contract field). The
 * discovery table's own badge stays server-computed (AC-2) — this helper
 * is never used to override or second-guess that.
 */
export function categorizePathForDisplay(path: string): "specs" | "docs" | "insights" | null {
  const segments = path.split("/");
  segments.pop();
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment === "specs" || segment === "docs" || segment === "insights") return segment;
  }
  return null;
}
