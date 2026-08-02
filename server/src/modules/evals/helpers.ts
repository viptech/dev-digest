import type { EvalCase, EvalRun, Finding, FindingCategory, Severity } from '@devdigest/shared';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

export interface ExpectedFinding {
  severity: Severity;
  file: string;
  category?: FindingCategory;
  start_line?: number;
}

export interface MatchResult {
  pass: boolean;
  recall: number;
  precision: number;
  matched: number;
}

/**
 * Greedy 1:1 matching: each expected entry claims at most one unused actual
 * finding with the same `file`+`severity` (and `category` when specified).
 * `pass` requires every expected entry matched AND no unmatched actual
 * findings left over (an exact set, not just a subset match) — mirrors the
 * "expected N, got M" pass/fail semantics from the product spec.
 */
export function matchFindings(expected: ExpectedFinding[], actual: Finding[]): MatchResult {
  const usedActual = new Set<number>();
  let matched = 0;

  for (const exp of expected) {
    const idx = actual.findIndex(
      (a, i) =>
        !usedActual.has(i) &&
        a.file === exp.file &&
        a.severity === exp.severity &&
        (exp.category === undefined || a.category === exp.category),
    );
    if (idx >= 0) {
      usedActual.add(idx);
      matched += 1;
    }
  }

  const recall = expected.length === 0 ? 1 : matched / expected.length;
  const precision = actual.length === 0 ? 1 : matched / actual.length;
  const pass = matched === expected.length && actual.length === expected.length;

  return { pass, recall, precision, matched };
}

/** Parse reviewer-core's "K/N passed" grounding summary into a 0–1 ratio. */
export function parseGroundingRatio(grounding: string): number {
  const m = /^(\d+)\/(\d+) passed$/.exec(grounding.trim());
  if (!m) return 1;
  const kept = Number(m[1]);
  const total = Number(m[2]);
  return total === 0 ? 1 : kept / total;
}

export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as 'skill' | 'agent',
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes ?? null,
  };
}

export function toEvalRunDto(row: EvalRunRow): EvalRun {
  return {
    recall: row.recall ?? 0,
    precision: row.precision ?? 0,
    citation_accuracy: row.citationAccuracy ?? 0,
    traces_passed: row.pass ? 1 : 0,
    traces_total: 1,
    duration_ms: row.durationMs ?? 0,
    cost_usd: row.costUsd,
    per_trace: [
      {
        name: row.id,
        pass: !!row.pass,
        expected: null,
        actual: row.actualOutput,
      },
    ],
  };
}
