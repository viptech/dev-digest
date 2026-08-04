import { describe, it, expect } from 'vitest';
import { classifyFile } from './classifier.js';

describe('classifyFile', () => {
  it.each([
    ['package-lock.json', 'boilerplate'],
    ['packages/foo/package-lock.json', 'boilerplate'],
    ['pnpm-lock.yaml', 'boilerplate'],
    ['a/b/c/pnpm-lock.yaml', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['dist/index.js', 'boilerplate'],
    ['packages/api/dist/nested/deep/file.js', 'boilerplate'],
    ['build/main.js', 'boilerplate'],
    ['.next/static/chunk.js', 'boilerplate'],
    ['src/__snapshots__/Component.test.tsx.snap', 'boilerplate'],
    ['src/components/Foo.test.tsx.snap', 'boilerplate'],
  ] as const)('classifies lock/build/snapshot file %s as %s (unconditionally)', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it.each([
    ['vite.config.ts', 'wiring'],
    ['jest.config.js', 'wiring'],
    ['src/index.ts', 'wiring'],
    ['src/components/index.tsx', 'wiring'],
    ['.env', 'wiring'],
    ['.env.production', 'wiring'],
    ['tsconfig.json', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
  ] as const)('classifies config/barrel file %s as %s', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it.each([
    ['src/modules/pulls/routes.ts', 'core'],
    ['src/components/PRRow/PRRow.tsx', 'core'],
    ['server/src/db/schema/pulls.ts', 'core'],
    ['README.md', 'core'],
  ] as const)('falls back to core for %s (the default, not a positive pattern list)', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it('never lets a boilerplate match get shadowed by a wiring pattern', () => {
    // A lock file nested under a directory named like a config dir must still
    // win as boilerplate — boilerplate is checked first, unconditionally.
    expect(classifyFile('config/package-lock.json')).toBe('boilerplate');
  });
});
