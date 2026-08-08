/**
 * repo-intel pipeline — reverse-import-graph walk (blast radius, T3).
 *
 * Pure function, mirrors `pipeline/rank.ts`'s style (plain-array in, no DB).
 * Given the repo's full import-edge list and a set of seed FILES, returns the
 * set of files that (transitively, up to `maxHops` hops) IMPORT one of the
 * seeds — i.e. "who would be affected if a seed file changed", walking the
 * graph in the reverse direction of `fromFile -> toFile` (importer -> imported).
 */
export function reverseImportersWithinHops(
  edges: { fromFile: string; toFile: string }[],
  seeds: string[],
  maxHops: number,
): Set<string> {
  const reverseAdj = new Map<string, string[]>(); // toFile -> fromFile[]
  for (const e of edges) {
    const arr = reverseAdj.get(e.toFile);
    if (arr) arr.push(e.fromFile); else reverseAdj.set(e.toFile, [e.fromFile]);
  }
  const visited = new Set<string>(seeds);
  let frontier = seeds;
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const importer of reverseAdj.get(file) ?? []) {
        if (!visited.has(importer)) { visited.add(importer); next.push(importer); }
      }
    }
    frontier = next;
  }
  for (const s of seeds) visited.delete(s);
  return visited;
}

/**
 * Test files (`*.test.ts` / `*.it.test.ts`, per `TESTING.md`'s own naming
 * convention) routinely import `app.ts`/route modules just to build a test
 * harness — a reverse-import walk from a changed file legitimately reaches
 * them, but they don't declare or expose HTTP endpoints of their own, only
 * exercise ones that already exist elsewhere. Consumers of
 * `reverseImportersWithinHops` that feed the result into endpoint/cron facts
 * should filter test files out first (see `RepoIntelService.tryPersistentBlast`).
 */
export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path);
}
