import { describe, it, expect } from 'vitest';
import { scoreEvalCase, parseGroundingRatio, computeActualCount } from '../src/modules/evals/helpers.js';
import type { EvalExpectation, Finding } from '@devdigest/shared';

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

function mustFind(over: Partial<EvalExpectation> = {}): EvalExpectation {
  return { type: 'must_find', file: 'src/a.ts', ...over };
}

function mustNotFlag(over: Partial<EvalExpectation> = {}): EvalExpectation {
  return { type: 'must_not_flag', file: 'src/a.ts', ...over };
}

describe('scoreEvalCase', () => {
  it('recall=1/precision=1/pass when a must_find expectation is matched by file only', () => {
    const result = scoreEvalCase([mustFind()], [finding()]);
    expect(result).toEqual({ pass: true, recall: 1, precision: 1, matched: 1 });
  });

  it('recall=0 when a must_find expectation has no matching actual finding', () => {
    const result = scoreEvalCase([mustFind()], []);
    expect(result.recall).toBe(0);
    expect(result.precision).toBe(1); // no actual findings → no false positives
    expect(result.pass).toBe(false);
  });

  it('must_find matches by file+line-range intersection, not just file', () => {
    const exp = mustFind({ start_line: 40, end_line: 45 });
    expect(scoreEvalCase([exp], [finding({ start_line: 42, end_line: 42 })]).recall).toBe(1);
    expect(scoreEvalCase([exp], [finding({ start_line: 100, end_line: 100 })]).recall).toBe(0);
  });

  it('empty must_find set → recall=1 (vacuously true) regardless of actual findings', () => {
    expect(scoreEvalCase([], []).recall).toBe(1);
    expect(scoreEvalCase([], [finding()]).recall).toBe(1);
  });

  it('a must_not_flag false positive penalizes precision', () => {
    const result = scoreEvalCase([mustNotFlag()], [finding()]);
    expect(result.precision).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('a finding outside every annotated zone is neutral — does NOT penalize precision', () => {
    const result = scoreEvalCase([mustNotFlag({ file: 'src/other.ts' })], [finding()]);
    expect(result.precision).toBe(1);
  });

  it('empty actual-findings set → precision=1 regardless of must_not_flag zones', () => {
    expect(scoreEvalCase([mustNotFlag()], []).precision).toBe(1);
  });

  it('AC-10: the same range marked both must_find and must_not_flag contributes to both independently', () => {
    const f = finding({ start_line: 10, end_line: 10 });
    const expectations: EvalExpectation[] = [
      mustFind({ start_line: 10, end_line: 10 }),
      mustNotFlag({ start_line: 10, end_line: 10 }),
    ];
    const result = scoreEvalCase(expectations, [f]);
    expect(result.recall).toBe(1); // the must_find zone was hit
    expect(result.precision).toBe(0); // the SAME finding also trips the must_not_flag zone
  });

  it('respects category/severity when the expectation specifies them', () => {
    const exp = mustFind({ category: 'bug', severity: 'WARNING' });
    // actual finding has category 'security' — expectation is file-only for
    // matching purposes (category/severity are descriptive metadata copied
    // from the source finding, not part of the match predicate) — still matches by file.
    const result = scoreEvalCase([exp], [finding({ category: 'security' })]);
    expect(result.recall).toBe(1);
  });
});

describe('computeActualCount', () => {
  // Development Plan evals-tab-mockup-alignment.md, Ordered Step 1 — feeds
  // EvalCaseWithLastRun.last_run.actual_count (server/src/modules/evals/service.ts's list()).
  it('counts the findings array when actual_output is an array', () => {
    expect(computeActualCount([finding(), finding({ id: 'f2' })])).toBe(2);
  });

  it('returns 0 for an empty findings array', () => {
    expect(computeActualCount([])).toBe(0);
  });

  it('returns 0 when actual_output is null (never run / failed run)', () => {
    expect(computeActualCount(null)).toBe(0);
  });

  it('returns 0 when actual_output is not an array (defensive — jsonb is untyped)', () => {
    expect(computeActualCount('not-an-array')).toBe(0);
    expect(computeActualCount(undefined)).toBe(0);
    expect(computeActualCount({})).toBe(0);
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
