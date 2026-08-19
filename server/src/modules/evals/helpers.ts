import type { EvalCase, EvalExpectation, EvalRun, EvalRunRecord, Finding } from '@devdigest/shared';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

export interface ScoreResult {
  pass: boolean;
  recall: number;
  precision: number;
  matched: number;
}

/** Two inclusive line ranges intersect. */
function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** An expectation matches a finding when `file` agrees and — when the
 *  expectation specifies a line range — that range intersects the finding's
 *  `[start_line, end_line]`. An expectation with no line range matches on
 *  `file` alone. */
function expectationMatchesFinding(exp: EvalExpectation, finding: Finding): boolean {
  if (exp.file !== finding.file) return false;
  if (exp.start_line == null || exp.end_line == null) return true;
  return rangesIntersect(exp.start_line, exp.end_line, finding.start_line, finding.end_line);
}

/**
 * Score one eval case's actual findings against its typed `EvalExpectation[]`
 * (SPEC-05 AC-6/AC-7/AC-9/AC-10). Deterministic, code-only — no LLM call here.
 *
 * - **recall** — fraction of `must_find` expectations matched by ≥1 actual
 *   finding; a case with no `must_find` expectations has `recall = 1`.
 * - **precision** — fraction of actual findings that do NOT intersect any
 *   `must_not_flag` zone; a finding outside every annotated zone (neither
 *   `must_find` nor `must_not_flag`) is NEUTRAL — it counts toward the
 *   numerator, it is never penalized. A case with no actual findings has
 *   `precision = 1`.
 * - AC-10: a range marked both `must_find` and `must_not_flag` contributes to
 *   the recall numerator AND the precision penalty independently — recall and
 *   precision are computed from separate expectation subsets, so this is not
 *   specially guarded against (and isn't validated away on write).
 * - **pass** — `recall === 1 && precision === 1`.
 */
export function scoreEvalCase(expectations: EvalExpectation[], actual: Finding[]): ScoreResult {
  const mustFind = expectations.filter((e) => e.type === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.type === 'must_not_flag');

  const matchedMustFind = mustFind.filter((exp) => actual.some((f) => expectationMatchesFinding(exp, f)));
  const recall = mustFind.length === 0 ? 1 : matchedMustFind.length / mustFind.length;

  const nonFalsePositives = actual.filter((f) => !mustNotFlag.some((exp) => expectationMatchesFinding(exp, f)));
  const precision = actual.length === 0 ? 1 : nonFalsePositives.length / actual.length;

  return {
    pass: recall === 1 && precision === 1,
    recall,
    precision,
    matched: matchedMustFind.length,
  };
}

/** Parse reviewer-core's "K/N passed" grounding summary into a 0–1 ratio. */
export function parseGroundingRatio(grounding: string): number {
  const m = /^(\d+)\/(\d+) passed$/.exec(grounding.trim());
  if (!m) return 1;
  const kept = Number(m[1]);
  const total = Number(m[2]);
  return total === 0 ? 1 : kept / total;
}

/** Count of findings in a persisted run's `actual_output` (jsonb, `unknown`
 *  at the type level) — feeds the `EvalCaseWithLastRun.last_run.actual_count`
 *  field consumed by the client's "expected N, got M" subtitle (Development
 *  Plan evals-tab-mockup-alignment.md). `actualOutput` is `null` for a
 *  case whose run threw (`runSet`'s per-case failure path) or hasn't
 *  finished — never assume it's an array without checking. */
export function computeActualCount(actualOutput: unknown): number {
  return Array.isArray(actualOutput) ? actualOutput.length : 0;
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
    expected_output: (row.expectedOutput ?? []) as EvalExpectation[],
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

/** A persisted `eval_runs` row as the API-facing `EvalRunRecord` shape —
 *  used both by the bulk set-run response's `cases[]` and by any future
 *  run-history read. `caseName` is optional (joined in by the caller when
 *  available; `null` otherwise). */
export function toEvalRunRecordDto(row: EvalRunRow, caseName?: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName ?? null,
    run_group_id: row.runGroupId ?? null,
    ran_at: new Date(row.ranAt).toISOString(),
    actual_output: row.actualOutput ?? null,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}
