import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** A1/T-conventions — data-access for `conventions`. Workspace + repo scoped. */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  evidencePath?: string | null;
  evidenceSnippet?: string | null;
  confidence?: number | null;
}

export interface UpdateConvention {
  rule?: string;
  accepted?: boolean;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence));
  }

  async insertMany(rows: InsertConvention[], db: Db = this.db): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          rule: r.rule,
          evidencePath: r.evidencePath ?? null,
          evidenceSnippet: r.evidenceSnippet ?? null,
          confidence: r.confidence ?? null,
          accepted: false,
        })),
      )
      .returning();
  }

  /** Drop candidates the user never accepted, before a re-scan writes fresh
   *  ones — keeps the list from growing unbounded across repeated "Extract"
   *  clicks while preserving anything already accepted. */
  async deleteUnaccepted(workspaceId: string, repoId: string, db: Db = this.db): Promise<void> {
    await db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, false),
        ),
      );
  }

  /** Atomically replaces the unaccepted candidates for a repo: delete the old
   *  ones and insert the fresh ones in a single transaction, so a DB failure
   *  between the two steps can't silently drop existing candidates without
   *  writing the new set. */
  async replaceUnaccepted(
    workspaceId: string,
    repoId: string,
    rows: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await this.deleteUnaccepted(workspaceId, repoId, tx);
      return this.insertMany(rows, tx);
    });
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async updateOne(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
