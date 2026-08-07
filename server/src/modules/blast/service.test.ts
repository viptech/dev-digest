import { describe, it, expect } from 'vitest';
import { assembleBlastRadius } from './service.js';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Pure-function unit tests for `assembleBlastRadius` — no I/O, mirrors
 * `smart-diff/service.test.ts`'s placement convention (co-located with the
 * module, not in top-level `server/test/`).
 */

function blastResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
}

describe('assembleBlastRadius', () => {
  it('groups callers by viaSymbol into separate downstream entries', () => {
    const result = assembleBlastRadius(
      blastResult({
        changedSymbols: [
          { file: 'src/a.ts', name: 'symA', kind: 'function' },
          { file: 'src/b.ts', name: 'symB', kind: 'function' },
        ],
        callers: [
          { file: 'src/callerA1.ts', symbol: 'callerA1', viaSymbol: 'symA', line: 10, rank: 5 },
          { file: 'src/callerA2.ts', symbol: 'callerA2', viaSymbol: 'symA', line: 20, rank: 3 },
          { file: 'src/callerB1.ts', symbol: 'callerB1', viaSymbol: 'symB', line: 30, rank: 9 },
        ],
      }),
    );

    expect(result.downstream).toHaveLength(2);
    const symA = result.downstream.find((d) => d.symbol === 'symA')!;
    const symB = result.downstream.find((d) => d.symbol === 'symB')!;
    expect(symA.callers).toHaveLength(2);
    expect(symB.callers).toHaveLength(1);
  });

  it('drops `rank` from each caller — server-internal sort key only, not on the wire', () => {
    const result = assembleBlastRadius(
      blastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'symA', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'symA', line: 10, rank: 5 }],
      }),
    );
    expect(result.downstream[0]!.callers[0]).toEqual({
      name: 'caller',
      file: 'src/caller.ts',
      line: 10,
    });
    expect(result.downstream[0]!.callers[0]).not.toHaveProperty('rank');
  });

  it('empty factsByFile (or missing entry) maps to [] endpoints/crons, not undefined', () => {
    const withoutFacts = assembleBlastRadius(
      blastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'symA', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'symA', line: 10, rank: 5 }],
        factsByFile: {},
      }),
    );
    expect(withoutFacts.downstream[0]!.endpoints_affected).toEqual([]);
    expect(withoutFacts.downstream[0]!.crons_affected).toEqual([]);

    const noFactsField = assembleBlastRadius(
      blastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'symA', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'symA', line: 10, rank: 5 }],
      }),
    );
    expect(noFactsField.downstream[0]!.endpoints_affected).toEqual([]);
    expect(noFactsField.downstream[0]!.crons_affected).toEqual([]);
  });

  it('endpoints_affected/crons_affected are read from factsByFile keyed by the SYMBOL\'S DECLARING (changed) file', () => {
    const result = assembleBlastRadius(
      blastResult({
        changedSymbols: [{ file: 'src/service.ts', name: 'symA', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'symA', line: 10, rank: 5 }],
        factsByFile: {
          'src/service.ts': { endpoints: ['GET /a'], crons: ['nightly'] },
          'src/caller.ts': { endpoints: ['GET /should-not-be-used'], crons: [] },
        },
      }),
    );
    expect(result.downstream[0]!.endpoints_affected).toEqual(['GET /a']);
    expect(result.downstream[0]!.crons_affected).toEqual(['nightly']);
  });

  it('passes through degraded/reason unchanged', () => {
    const degraded = assembleBlastRadius(
      blastResult({ degraded: true, reason: 'index_partial' }),
    );
    expect(degraded.degraded).toBe(true);
    expect(degraded.reason).toBe('index_partial');

    const notDegraded = assembleBlastRadius(blastResult({ degraded: false }));
    expect(notDegraded.degraded).toBe(false);
    expect(notDegraded.reason).toBeUndefined();
  });

  it('summary is a deterministic string reflecting counts — no LLM call anywhere', () => {
    const result = assembleBlastRadius(
      blastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'symA', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'symA', line: 10, rank: 5 }],
        impactedEndpoints: ['GET /a'],
      }),
    );
    expect(result.summary).toBe('1 symbol(s) changed, 1 caller(s), 1 endpoint(s) potentially affected');
  });

  it('direct field rename for changed_symbols (file/name/kind already match)', () => {
    const result = assembleBlastRadius(
      blastResult({ changedSymbols: [{ file: 'src/a.ts', name: 'symA', kind: 'function' }] }),
    );
    expect(result.changed_symbols).toEqual([{ file: 'src/a.ts', name: 'symA', kind: 'function' }]);
  });
});
