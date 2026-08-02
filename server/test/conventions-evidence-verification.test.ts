import { describe, it, expect } from 'vitest';
import { verifyEvidence } from '../src/modules/conventions/evidence-verification.js';

function mockFiles(files: Record<string, string>) {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

describe('verifyEvidence', () => {
  it('keeps a candidate whose file and line both exist', () => {
    const files = mockFiles({ 'src/a.ts': 'line1\nline2\nline3\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 2, rule: 'x' }];
    const result = verifyEvidence(files, candidates);
    expect(result).toHaveLength(1);
  });

  it('drops a candidate whose file does not exist among the read files', () => {
    const files = mockFiles({});
    const candidates = [{ evidence_path: 'src/missing.ts', evidence_line: 1, rule: 'x' }];
    const result = verifyEvidence(files, candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is beyond the file length', () => {
    const files = mockFiles({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 99, rule: 'x' }];
    const result = verifyEvidence(files, candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is 0 or negative', () => {
    const files = mockFiles({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 0, rule: 'x' }];
    const result = verifyEvidence(files, candidates);
    expect(result).toHaveLength(0);
  });

  it('keeps some and drops others in a mixed batch', () => {
    const files = mockFiles({ 'src/a.ts': 'l1\nl2\n' });
    const candidates = [
      { evidence_path: 'src/a.ts', evidence_line: 1, rule: 'good' },
      { evidence_path: 'src/gone.ts', evidence_line: 1, rule: 'bad-file' },
      { evidence_path: 'src/a.ts', evidence_line: 50, rule: 'bad-line' },
    ];
    const result = verifyEvidence(files, candidates);
    expect(result.map((c) => c.rule)).toEqual(['good']);
  });

  it('drops a candidate whose evidence_path was never read/shown to the model, even if that path exists elsewhere', () => {
    // Guards against a model hallucinating an evidence_path (e.g. a traversal-adjacent
    // string) that was not part of the files it was actually given.
    const files = mockFiles({ 'src/a.ts': 'l1\nl2\nl3\n' });
    const candidates = [{ evidence_path: '../../../.devdigest/secrets.json', evidence_line: 1, rule: 'x' }];
    const result = verifyEvidence(files, candidates);
    expect(result).toHaveLength(0);
  });
});
