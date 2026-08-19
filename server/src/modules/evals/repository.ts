import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
export type { EvalCaseRow, EvalRunRow };

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  /** Shared by every case's row within one bulk set-run; `null` for a
   *  single-case run (SPEC-05). */
  runGroupId?: string | null;
  actualOutput: unknown;
  pass: boolean;
  /** `null` when the case's run failed (AC-14) — excluded from aggregates,
   *  never coerced to 0. */
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  async listByOwner(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async insert(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        runGroupId: values.runGroupId ?? null,
        actualOutput: values.actualOutput as object,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }

  /** The most recent run per case id (for the case list's "last run" badge). */
  async latestRunByCase(caseIds: string[]): Promise<Map<string, EvalRunRow>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt), desc(t.evalRuns.id));
    const out = new Map<string, EvalRunRow>();
    for (const row of rows) {
      if (!out.has(row.caseId)) out.set(row.caseId, row); // first hit per case = newest (orderBy desc)
    }
    return out;
  }

  /** Every set-run row (i.e. `run_group_id IS NOT NULL`) for this owner,
   *  newest first, each joined with its case's name (AC-17 run history). */
  async listSetRunsByOwner(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<Array<EvalRunRow & { caseName: string }>> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
          isNotNull(t.evalRuns.runGroupId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
    return rows.map((r) => ({ ...r.run, caseName: r.caseName }));
  }

  /** `eval_cases` count per `owner_id`, workspace-wide (Eval Dashboard,
   *  AC-20) — one aggregate query, not one per agent. */
  async caseCountsByOwner(workspaceId: string, ownerKind: 'skill' | 'agent'): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, count: sql<number>`count(*)` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, ownerKind)))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.ownerId, Number(r.count)]));
  }

  /** Every set-run row workspace-wide (any owner), newest first, joined with
   *  its case's `owner_id`+name (Eval Dashboard, AC-20) — one aggregate
   *  query; grouping into "latest run-group per agent" happens in the
   *  service layer, not per-agent queries here. */
  async allSetRuns(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
  ): Promise<Array<EvalRunRow & { ownerId: string; caseName: string }>> {
    const rows = await this.db
      .select({ run: t.evalRuns, ownerId: t.evalCases.ownerId, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          isNotNull(t.evalRuns.runGroupId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
    return rows.map((r) => ({ ...r.run, ownerId: r.ownerId, caseName: r.caseName }));
  }
}
