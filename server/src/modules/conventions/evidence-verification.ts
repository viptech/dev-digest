export interface EvidenceVerificationRepoIntel {
  readFiles(repoId: string, paths: string[]): Promise<{ path: string; content: string }[]>;
}

/**
 * Mechanically confirms each candidate's cited file exists in the clone and
 * its `evidence_line` is a valid 1-based line number within that file.
 * Candidates that fail either check are dropped BEFORE persistence — this is
 * a structural check only (file/line exist), not a semantic check that the
 * line actually demonstrates the claimed rule.
 */
export async function verifyEvidence<T extends { evidence_path: string; evidence_line: number }>(
  repoIntel: EvidenceVerificationRepoIntel,
  repoId: string,
  candidates: T[],
): Promise<T[]> {
  const paths = [...new Set(candidates.map((c) => c.evidence_path))];
  const files = await repoIntel.readFiles(repoId, paths);
  const lineCounts = new Map(files.map((f) => [f.path, f.content.split('\n').length]));

  return candidates.filter((c) => {
    const lineCount = lineCounts.get(c.evidence_path);
    if (lineCount === undefined) return false;
    return c.evidence_line >= 1 && c.evidence_line <= lineCount;
  });
}
