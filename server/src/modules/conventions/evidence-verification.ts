/**
 * Mechanically confirms each candidate's cited file is among the files that
 * were actually read and shown to the model, and that its `evidence_line` is
 * a valid 1-based line number within that file's content. Candidates that
 * fail either check are dropped BEFORE persistence — this is a structural
 * check only (file/line exist), not a semantic check that the line actually
 * demonstrates the claimed rule.
 *
 * Takes the already-fetched `files` array (not a repoIntel + repoId pair) so
 * a candidate's `evidence_path` must match a path that was actually read —
 * it cannot smuggle in an arbitrary/traversal-adjacent path the model
 * hallucinated, and it avoids a redundant second disk read.
 */
export function verifyEvidence<T extends { evidence_path: string; evidence_line: number }>(
  files: { path: string; content: string }[],
  candidates: T[],
): T[] {
  const lineCounts = new Map(files.map((f) => [f.path, f.content.split('\n').length]));

  return candidates.filter((c) => {
    const lineCount = lineCounts.get(c.evidence_path);
    if (lineCount === undefined) return false;
    return c.evidence_line >= 1 && c.evidence_line <= lineCount;
  });
}
