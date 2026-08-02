import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { StatsFinding, StatsRun } from './stats-helpers.js';

const WINDOW_DAYS = 30;

export class StatsRepository {
  constructor(private db: Db) {}

  async getWindowData(
    workspaceId: string,
    agentId: string,
  ): Promise<{ runs: StatsRun[]; findings: StatsFinding[]; skillNames: Map<string, string> }> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const runRows = await this.db
      .select({
        id: t.agentRuns.id,
        ranAt: t.agentRuns.ranAt,
        durationMs: t.agentRuns.durationMs,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
        findingsCount: t.agentRuns.findingsCount,
        skillIds: t.agentRuns.skillIds,
        source: t.agentRuns.source,
        prNumber: t.pullRequests.number,
      })
      .from(t.agentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          gte(t.agentRuns.ranAt, since),
        ),
      );

    const runs: StatsRun[] = runRows.map((r) => ({
      id: r.id,
      ranAt: r.ranAt,
      durationMs: r.durationMs,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: r.costUsd,
      findingsCount: r.findingsCount,
      skillIds: (r.skillIds as string[] | null) ?? null,
      prNumber: r.prNumber ?? null,
      source: (r.source as 'local' | 'ci') ?? 'local',
    }));

    const reviewRows = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.agentId, agentId),
          gte(t.reviews.createdAt, since),
        ),
      );
    const reviewIds = reviewRows.map((r) => r.id);

    const findingRows = reviewIds.length
      ? await this.db
          .select({
            severity: t.findings.severity,
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
            dismissedAt: t.findings.dismissedAt,
          })
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
      : [];
    const findings: StatsFinding[] = findingRows.map((f) => ({
      severity: f.severity as StatsFinding['severity'],
      category: f.category,
      acceptedAt: f.acceptedAt,
      dismissedAt: f.dismissedAt,
    }));

    const skillIds = [...new Set(runs.flatMap((r) => r.skillIds ?? []))];
    const skillRows = skillIds.length
      ? await this.db.select({ id: t.skills.id, name: t.skills.name }).from(t.skills).where(inArray(t.skills.id, skillIds))
      : [];
    const skillNames = new Map(skillRows.map((s) => [s.id, s.name]));

    return { runs, findings, skillNames };
  }
}
