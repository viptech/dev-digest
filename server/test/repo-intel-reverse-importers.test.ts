import { describe, it, expect } from 'vitest';
import { reverseImportersWithinHops, isTestFile } from '../src/modules/repo-intel/pipeline/reverse-importers.js';

/**
 * Pure `reverseImportersWithinHops` — no DB, plain arrays in/out.
 */
describe('reverseImportersWithinHops', () => {
  it('0-hop: returns empty (the seed itself is excluded)', () => {
    const edges = [{ fromFile: 'a.ts', toFile: 'b.ts' }];
    expect(reverseImportersWithinHops(edges, ['b.ts'], 0)).toEqual(new Set());
  });

  it('1-hop: only direct importers of the seed', () => {
    const edges = [
      { fromFile: 'a.ts', toFile: 'b.ts' }, // a imports b
      { fromFile: 'z.ts', toFile: 'b.ts' }, // z imports b
      { fromFile: 'x.ts', toFile: 'a.ts' }, // x imports a (2 hops from b)
    ];
    const result = reverseImportersWithinHops(edges, ['b.ts'], 1);
    expect(result).toEqual(new Set(['a.ts', 'z.ts']));
  });

  it('2-hop: importers-of-importers are included', () => {
    const edges = [
      { fromFile: 'route.ts', toFile: 'service.ts' }, // route imports service
      { fromFile: 'service.ts', toFile: 'helper.ts' }, // service imports helper
    ];
    const result = reverseImportersWithinHops(edges, ['helper.ts'], 2);
    expect(result).toEqual(new Set(['service.ts', 'route.ts']));
  });

  it('a cycle (a -> b -> a) terminates without duplication', () => {
    const edges = [
      { fromFile: 'a.ts', toFile: 'b.ts' },
      { fromFile: 'b.ts', toFile: 'a.ts' },
    ];
    const result = reverseImportersWithinHops(edges, ['a.ts'], 5);
    // b.ts imports a.ts (seed) -> included. a.ts imports b.ts -> b.ts already
    // visited, no re-add, and the seed itself never leaks into the result.
    expect(result).toEqual(new Set(['b.ts']));
  });

  it('disjoint components do not leak into the result', () => {
    const edges = [
      { fromFile: 'a.ts', toFile: 'seed.ts' },
      { fromFile: 'x.ts', toFile: 'y.ts' }, // unrelated component
    ];
    const result = reverseImportersWithinHops(edges, ['seed.ts'], 2);
    expect(result).toEqual(new Set(['a.ts']));
    expect(result.has('x.ts')).toBe(false);
    expect(result.has('y.ts')).toBe(false);
  });

  it('multiple seeds: reachable sets are unioned, seeds themselves excluded even if one seed imports another', () => {
    const edges = [
      { fromFile: 'importer.ts', toFile: 'seed1.ts' },
      { fromFile: 'seed2.ts', toFile: 'seed1.ts' },
    ];
    const result = reverseImportersWithinHops(edges, ['seed1.ts', 'seed2.ts'], 2);
    expect(result).toEqual(new Set(['importer.ts']));
  });
});

describe('isTestFile', () => {
  it('matches .test.ts and .it.test.ts (both real filenames in this repo)', () => {
    expect(isTestFile('server/test/agents-versions.it.test.ts')).toBe(true);
    expect(isTestFile('server/src/modules/blast/service.test.ts')).toBe(true);
  });

  it('matches .test.tsx/.spec.ts/.spec.tsx too', () => {
    expect(isTestFile('client/src/components/Foo.test.tsx')).toBe(true);
    expect(isTestFile('src/foo.spec.ts')).toBe(true);
    expect(isTestFile('src/foo.spec.tsx')).toBe(true);
  });

  it('does not match a real source file, even one with "test" in the name', () => {
    expect(isTestFile('src/modules/repo-intel/service.ts')).toBe(false);
    expect(isTestFile('src/testing-utils.ts')).toBe(false);
    expect(isTestFile('src/test-helpers/index.ts')).toBe(false);
  });
});
