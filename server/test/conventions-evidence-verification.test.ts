import { describe, it, expect, vi } from 'vitest';
import { verifyEvidence } from '../src/modules/conventions/evidence-verification.js';

function mockRepoIntel(files: Record<string, string>) {
  return {
    readFiles: vi.fn().mockImplementation(async (_repoId: string, paths: string[]) =>
      paths.filter((p) => p in files).map((p) => ({ path: p, content: files[p]! })),
    ),
  };
}

describe('verifyEvidence', () => {
  it('keeps a candidate whose file and line both exist', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\nline3\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 2, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(1);
  });

  it('drops a candidate whose file does not exist in the clone', async () => {
    const repoIntel = mockRepoIntel({});
    const candidates = [{ evidence_path: 'src/missing.ts', evidence_line: 1, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is beyond the file length', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 99, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is 0 or negative', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 0, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('keeps some and drops others in a mixed batch', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'l1\nl2\n' });
    const candidates = [
      { evidence_path: 'src/a.ts', evidence_line: 1, rule: 'good' },
      { evidence_path: 'src/gone.ts', evidence_line: 1, rule: 'bad-file' },
      { evidence_path: 'src/a.ts', evidence_line: 50, rule: 'bad-line' },
    ];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result.map((c) => c.rule)).toEqual(['good']);
  });
});
