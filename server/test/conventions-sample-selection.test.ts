import { describe, it, expect, vi } from 'vitest';
import { getCodeOnlySamples } from '../src/modules/conventions/sample-selection.js';

function mockRepoIntel(existingFiles: Set<string>, rankedFiles: string[]) {
  return {
    getConventionSamples: vi.fn().mockResolvedValue(rankedFiles),
    readFiles: vi.fn().mockImplementation(async (_repoId: string, paths: string[]) =>
      paths.filter((p) => existingFiles.has(p)).map((p) => ({ path: p, content: '// x' })),
    ),
  };
}

describe('getCodeOnlySamples', () => {
  it('includes existing config files plus the ranked samples, deduplicated', async () => {
    const repoIntel = mockRepoIntel(
      new Set(['tsconfig.json', '.eslintrc.json']),
      ['src/a.ts', 'src/b.ts'],
    );
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result).toEqual(expect.arrayContaining(['tsconfig.json', '.eslintrc.json', 'src/a.ts', 'src/b.ts']));
    expect(new Set(result).size).toBe(result.length); // no duplicates
  });

  it('skips config files that do not exist in the clone, without error', async () => {
    const repoIntel = mockRepoIntel(new Set([]), ['src/a.ts']);
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result).toEqual(['src/a.ts']);
  });

  it('deduplicates when a config file is also returned by getConventionSamples', async () => {
    const repoIntel = mockRepoIntel(new Set(['tsconfig.json']), ['tsconfig.json', 'src/a.ts']);
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result.filter((p) => p === 'tsconfig.json')).toHaveLength(1);
  });
});
