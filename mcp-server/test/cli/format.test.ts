import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { determineExitCode, formatFindings, EXIT_CLEAN, EXIT_BLOCKING_FINDINGS } from '../../src/cli/format.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'Because.',
    confidence: 0.8,
    ...overrides,
  };
}

describe('determineExitCode', () => {
  it('EXIT_CLEAN when there are no findings at all', () => {
    expect(determineExitCode([])).toBe(EXIT_CLEAN);
  });

  it('EXIT_CLEAN when findings exist but none are CRITICAL', () => {
    expect(determineExitCode([finding({ severity: 'WARNING' }), finding({ severity: 'SUGGESTION' })])).toBe(
      EXIT_CLEAN,
    );
  });

  it('EXIT_BLOCKING_FINDINGS when at least one finding is CRITICAL', () => {
    expect(determineExitCode([finding({ severity: 'WARNING' }), finding({ severity: 'CRITICAL' })])).toBe(
      EXIT_BLOCKING_FINDINGS,
    );
  });
});

describe('formatFindings', () => {
  it("returns 'No findings.' for an empty array", () => {
    expect(formatFindings([])).toBe('No findings.\n');
  });

  it('sorts worst-severity-first (CRITICAL, then WARNING, then SUGGESTION)', () => {
    const out = formatFindings([
      finding({ id: 'a', severity: 'SUGGESTION', title: 'sugg' }),
      finding({ id: 'b', severity: 'CRITICAL', title: 'crit' }),
      finding({ id: 'c', severity: 'WARNING', title: 'warn' }),
    ]);
    const critIdx = out.indexOf('crit');
    const warnIdx = out.indexOf('warn');
    const suggIdx = out.indexOf('sugg');
    expect(critIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(suggIdx);
  });

  it('formats a single-line finding as file:line, a multi-line one as file:start-end', () => {
    const out = formatFindings([
      finding({ file: 'src/a.ts', start_line: 5, end_line: 5, title: 'one-line' }),
      finding({ file: 'src/b.ts', start_line: 5, end_line: 8, title: 'multi-line' }),
    ]);
    expect(out).toContain('src/a.ts:5 — one-line');
    expect(out).toContain('src/b.ts:5-8 — multi-line');
  });

  it('includes the rationale under each finding', () => {
    const out = formatFindings([finding({ rationale: 'A very specific reason.' })]);
    expect(out).toContain('A very specific reason.');
  });
});
