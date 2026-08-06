import { describe, it, expect, vi } from 'vitest';
import { SmartDiffService, assembleSmartDiff } from './service.js';
import type { FindingRow, PrFileRow, SmartDiffRepo } from './repository.js';

function prFile(overrides: Partial<PrFileRow> = {}): PrFileRow {
  return {
    id: 'file-1',
    prId: 'pr-1',
    path: 'src/service.ts',
    additions: 10,
    deletions: 2,
    patch: null,
    ...overrides,
  } as PrFileRow;
}

function finding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f1',
    reviewId: 'r1',
    file: 'src/service.ts',
    startLine: 12,
    endLine: 14,
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    rationale: 'Because',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

describe('assembleSmartDiff (pure)', () => {
  it('groups files by role and attaches sorted findings (line + severity) per file', () => {
    const files = [
      prFile({ path: 'package-lock.json', additions: 1000, deletions: 900 }),
      prFile({ path: 'src/index.ts', additions: 5, deletions: 1 }),
      prFile({ path: 'src/service.ts', additions: 20, deletions: 3 }),
    ];
    const findings = [
      finding({ file: 'src/service.ts', startLine: 30, severity: 'CRITICAL' }),
      finding({ file: 'src/service.ts', startLine: 12, severity: 'WARNING' }),
      finding({ file: 'src/index.ts', startLine: 5, severity: 'SUGGESTION' }),
    ];

    const result = assembleSmartDiff(files, findings);

    const roles = result.groups.map((g) => g.role);
    expect(roles).toEqual(['core', 'wiring', 'boilerplate']);

    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files).toHaveLength(1);
    expect(core.files[0]).toMatchObject({
      path: 'src/service.ts',
      pseudocode_summary: null,
      additions: 20,
      deletions: 3,
      findings: [
        { line: 12, severity: 'WARNING' },
        { line: 30, severity: 'CRITICAL' },
      ],
    });

    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files[0]).toMatchObject({ path: 'src/index.ts', findings: [{ line: 5, severity: 'SUGGESTION' }] });

    const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files[0]).toMatchObject({ path: 'package-lock.json', findings: [] });
  });

  it('degrades to findings: [] for every file when no review has run yet', () => {
    const files = [prFile({ path: 'src/a.ts' }), prFile({ path: 'src/b.ts' })];
    const result = assembleSmartDiff(files, []);
    for (const group of result.groups) {
      for (const f of group.files) expect(f.findings).toEqual([]);
    }
  });

  it('omits empty role groups entirely', () => {
    const result = assembleSmartDiff([prFile({ path: 'src/only-core.ts' })], []);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.role).toBe('core');
  });

  it('flags too_big only once total additions+deletions crosses the threshold, with a deterministic per-role split', () => {
    const bigFiles = Array.from({ length: 10 }, (_, i) =>
      prFile({ path: `src/file-${i}.ts`, additions: 50, deletions: 0 }),
    ); // 500 total lines > SPLIT_THRESHOLD_LINES (400)
    const result = assembleSmartDiff(bigFiles, []);
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(500);
    expect(result.split_suggestion.proposed_splits).toEqual([{ name: 'core', files: bigFiles.map((f) => f.path) }]);
  });

  it('never proposes splits for a small PR', () => {
    const result = assembleSmartDiff([prFile({ additions: 5, deletions: 1 })], []);
    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });
});

describe('SmartDiffService.build (assembly with a stub repository, no DB)', () => {
  it('never touches any LLM — only the repository port is called', async () => {
    const llmSpy = vi.fn();
    const repo: SmartDiffRepo = {
      getPrFiles: vi.fn(async () => [prFile({ path: 'src/service.ts' })]),
      latestReviewFindings: vi.fn(async () => [finding({ file: 'src/service.ts', startLine: 12 })]),
    };
    const service = new SmartDiffService(repo);

    const result = await service.build('pr-1');

    expect(repo.getPrFiles).toHaveBeenCalledWith('pr-1');
    expect(repo.latestReviewFindings).toHaveBeenCalledWith('pr-1');
    expect(llmSpy).not.toHaveBeenCalled(); // never wired to anything LLM-shaped
    expect(result.groups.find((g) => g.role === 'core')!.files[0]!.findings).toEqual([
      { id: 'f1', line: 12, severity: 'WARNING' },
    ]);
  });

  it('degrades to findings: [] when the findings lookup rejects (no review yet)', async () => {
    const repo: SmartDiffRepo = {
      getPrFiles: vi.fn(async () => [prFile({ path: 'src/service.ts' })]),
      latestReviewFindings: vi.fn(async () => {
        throw new Error('no review row');
      }),
    };
    const service = new SmartDiffService(repo);

    const result = await service.build('pr-1');
    expect(result.groups.find((g) => g.role === 'core')!.files[0]!.findings).toEqual([]);
  });
});
