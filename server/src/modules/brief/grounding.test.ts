import { describe, it, expect } from 'vitest';
import { groundRisks, groundReviewFocus } from './grounding.js';
import type { Risk, ReviewFocusItem } from '@devdigest/shared';

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: 'security',
    title: 'Live secret committed',
    explanation: 'A Stripe key is committed in plaintext.',
    severity: 'high',
    file_refs: ['src/config.ts'],
    ...overrides,
  };
}

function focusItem(overrides: Partial<ReviewFocusItem> = {}): ReviewFocusItem {
  return { path: 'src/config.ts', line: 12, note: 'Look here first.', ...overrides };
}

describe('groundRisks — AC-5', () => {
  it('drops a single bad file_ref but keeps the risk when others remain grounded', () => {
    const knownUniverse = new Set(['src/config.ts']);
    const [result] = groundRisks(
      [risk({ file_refs: ['src/config.ts', 'src/invented.ts'] })],
      knownUniverse,
    );
    expect(result!.file_refs).toEqual(['src/config.ts']);
  });

  it('drops the WHOLE risk when every file_ref is ungrounded', () => {
    const knownUniverse = new Set(['src/config.ts']);
    const result = groundRisks([risk({ file_refs: ['src/invented.ts'] })], knownUniverse);
    expect(result).toHaveLength(0);
  });

  it('a file_ref with stray leading/trailing whitespace still grounds against a trimmed knownUniverse entry (m9)', () => {
    const knownUniverse = new Set(['GET /pulls/:id']);
    const [result] = groundRisks([risk({ file_refs: [' GET /pulls/:id '] })], knownUniverse);
    expect(result!.file_refs).toEqual([' GET /pulls/:id ']); // kept verbatim, only the MATCH is trimmed
  });

  it('keeps a risk untouched when every file_ref is already grounded', () => {
    const knownUniverse = new Set(['src/config.ts', 'src/other.ts']);
    const [result] = groundRisks([risk({ file_refs: ['src/config.ts', 'src/other.ts'] })], knownUniverse);
    expect(result!.file_refs).toEqual(['src/config.ts', 'src/other.ts']);
  });
});

describe('groundReviewFocus — AC-6', () => {
  it('drops a whole item on an ungrounded path', () => {
    const changedPaths = new Set(['src/config.ts']);
    const result = groundReviewFocus([focusItem({ path: 'src/invented.ts' })], changedPaths);
    expect(result).toHaveLength(0);
  });

  it('keeps a grounded item untouched', () => {
    const changedPaths = new Set(['src/config.ts']);
    const result = groundReviewFocus([focusItem()], changedPaths);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(focusItem());
  });

  it('a path with stray whitespace still grounds against a trimmed changedPaths entry', () => {
    const changedPaths = new Set(['src/config.ts']);
    const result = groundReviewFocus([focusItem({ path: ' src/config.ts ' })], changedPaths);
    expect(result).toHaveLength(1);
  });
});
