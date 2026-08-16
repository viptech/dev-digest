import { eq } from 'drizzle-orm';
import type { Brief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * brief repository — data access for the `pr_brief` cache row (jsonb `json`
 * column + `provider_used`/`model_used`/`head_sha`/`created_at`; PK =
 * `pr_id`, migration `0015_tiresome_expediter.sql`).
 */

export interface PrBriefRow {
  prId: string;
  json: unknown;
  providerUsed: string;
  modelUsed: string;
  headSha: string;
  createdAt: Date;
}

export class BriefRepository {
  constructor(private db: Db) {}

  async getByPrId(prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * INSERT ... ON CONFLICT (pr_id) DO UPDATE — called ONLY from the
   * non-degraded success path of `BriefService.generate()` (AC-10; a
   * degraded/failed-call result is NEVER persisted).
   *
   * `createdAt` is an explicit PARAMETER, not left to the column's own
   * `.defaultNow()` — that default only fires on INSERT; on an
   * ON CONFLICT DO UPDATE it would silently leave the FIRST generation's
   * timestamp in place forever (cross-model review finding B4). Explicit in
   * BOTH `values` and `set`, same shape as `onboarding/repository.ts`'s
   * `generatedAt` parameter.
   */
  async upsert(
    prId: string,
    row: { json: Brief; providerUsed: string; modelUsed: string; headSha: string; createdAt: Date },
  ): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, ...row })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: {
          json: row.json,
          providerUsed: row.providerUsed,
          modelUsed: row.modelUsed,
          headSha: row.headSha,
          createdAt: row.createdAt,
        },
      });
  }
}
