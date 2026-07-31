import { describe, it, expect } from 'vitest';
import { buildFindingsSummary } from './findings-summary.js';
import type { FindingRow } from '../../db/rows.js';

function row(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f1',
    reviewId: 'r1',
    file: 'src/api/users.ts',
    startLine: 45,
    endLine: 52,
    severity: 'WARNING',
    category: 'perf',
    title: 'N+1 query in user list endpoint',
    rationale: 'The loop calls db.posts.findMany once per user.',
    suggestion: null,
    confidence: 0.86,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

describe('buildFindingsSummary', () => {
  it('counts findings per severity and carries the display fields through', () => {
    const summary = buildFindingsSummary([
      row({ id: 'f1', severity: 'CRITICAL' }),
      row({ id: 'f2', severity: 'WARNING' }),
      row({ id: 'f3', severity: 'WARNING' }),
    ]);
    expect(summary.counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(summary.items).toHaveLength(3);
    expect(summary.items[1]).toEqual({
      id: 'f2',
      severity: 'WARNING',
      category: 'perf',
      title: 'N+1 query in user list endpoint',
      file: 'src/api/users.ts',
      start_line: 45,
      end_line: 52,
      confidence: 0.86,
      rationale: 'The loop calls db.posts.findMany once per user.',
    });
  });

  it('returns zeroed counts and an empty item list for no findings', () => {
    const summary = buildFindingsSummary([]);
    expect(summary.counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(summary.items).toEqual([]);
  });
});
