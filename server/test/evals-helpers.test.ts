import { describe, it, expect } from 'vitest';
import { matchFindings, parseGroundingRatio } from '../src/modules/evals/helpers.js';
import type { Finding } from '@devdigest/shared';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'x',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'r',
    confidence: 0.9,
    ...over,
  };
}

describe('matchFindings', () => {
  it('passes when actual exactly matches one expected finding by file+severity', () => {
    const expected = [{ severity: 'CRITICAL' as const, file: 'src/a.ts' }];
    const actual = [finding()];
    const result = matchFindings(expected, actual);
    expect(result).toEqual({ pass: true, recall: 1, precision: 1, matched: 1 });
  });

  it('fails when expected 1 but got 0', () => {
    const expected = [{ severity: 'CRITICAL' as const, file: 'src/a.ts' }];
    const result = matchFindings(expected, []);
    expect(result.pass).toBe(false);
    expect(result.recall).toBe(0);
    expect(result.precision).toBe(1); // no actual findings → no false positives
  });

  it('passes when expecting zero findings and getting zero', () => {
    const result = matchFindings([], []);
    expect(result).toEqual({ pass: true, recall: 1, precision: 1, matched: 0 });
  });

  it('fails (extra finding) when expecting zero but getting one', () => {
    const result = matchFindings([], [finding()]);
    expect(result.pass).toBe(false);
    expect(result.precision).toBe(0);
  });

  it('does not double-match one actual finding against two expected entries', () => {
    const expected = [
      { severity: 'CRITICAL' as const, file: 'src/a.ts' },
      { severity: 'CRITICAL' as const, file: 'src/a.ts' },
    ];
    const result = matchFindings(expected, [finding()]);
    expect(result.matched).toBe(1);
    expect(result.pass).toBe(false); // 2 expected, only 1 actual
    expect(result.recall).toBe(0.5);
  });

  it('respects category when the expected matcher specifies one', () => {
    const expected = [{ severity: 'CRITICAL' as const, file: 'src/a.ts', category: 'bug' as const }];
    const result = matchFindings(expected, [finding({ category: 'security' })]);
    expect(result.matched).toBe(0);
  });
});

describe('parseGroundingRatio', () => {
  it('parses "K/N passed"', () => {
    expect(parseGroundingRatio('3/4 passed')).toBeCloseTo(0.75);
  });
  it('defaults to 1 when N is 0', () => {
    expect(parseGroundingRatio('0/0 passed')).toBe(1);
  });
  it('returns 1 for an unparseable string rather than throwing', () => {
    expect(parseGroundingRatio('nonsense')).toBe(1);
  });
});
