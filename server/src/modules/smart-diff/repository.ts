import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Smart Diff data-access. The ONLY layer touching the DB for this feature —
 * reads `pr_files` (already persisted by the pulls module's GitHub-refresh /
 * offline-fallback paths) and the latest **review**'s findings (already
 * persisted by the reviews module). No new table, no write path here.
 */

export type PrFileRow = typeof t.prFiles.$inferSelect;
export type FindingRow = typeof t.findings.$inferSelect;

/** Port the service depends on — lets tests inject a stub without a DB. */
export interface SmartDiffRepo {
  getPrFiles(prId: string): Promise<PrFileRow[]>;
  latestReviewFindings(prId: string): Promise<FindingRow[]>;
}

export class SmartDiffRepository implements SmartDiffRepo {
  constructor(private db: Db) {}

  async getPrFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  /**
   * Findings of the **latest** review for a PR (kind='review', newest first,
   * first-seen-wins — mirrors `pulls/routes.ts:130-157`'s exact query shape).
   * Returns `[]` when no review has ever run; never throws for that case (the
   * caller may still wrap this in a `.catch` for the best-effort-degrade
   * precedent at `pulls/routes.ts:222`, e.g. a transient DB hiccup).
   */
  async latestReviewFindings(prId: string): Promise<FindingRow[]> {
    const reviewRows = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    const latestReviewId = reviewRows[0]?.id;
    if (!latestReviewId) return [];
    return this.db.select().from(t.findings).where(inArray(t.findings.reviewId, [latestReviewId]));
  }
}
