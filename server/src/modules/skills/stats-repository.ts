import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillStatsFinding, SkillStatsRun } from './stats-helpers.js';

const WINDOW_DAYS = 30;

/**
 * A1 — raw rows for `computeSkillStats` (stats-helpers.js). Mirrors
 * `agents/stats-repository.ts` one hop further: agent_skills → agent_runs →
 * reviews → findings. Existing FKs/PKs only, no new index — this query shape
 * is the already-accepted `agents/stats-repository.ts` pattern extended by
 * one join (SPEC-06 Development Plan, postgresql-table-design skill check).
 */
export class SkillStatsRepository {
  constructor(private db: Db) {}

  async getWindowData(
    workspaceId: string,
    skillId: string,
  ): Promise<{
    agentIds: string[];
    agentNames: Map<string, string>;
    runs: SkillStatsRun[];
    findings: SkillStatsFinding[];
  }> {
    // AC-23: direct attachment only — distinct agents CURRENTLY linking this
    // skill via agent_skills, never a transitive/historical notion.
    const linkRows = await this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    const agentIds = [...new Set(linkRows.map((r) => r.agentId))];

    // AC-27: never-linked skill — short-circuit before any further join, no
    // failing/expensive query on an empty id set.
    if (agentIds.length === 0) {
      return { agentIds: [], agentNames: new Map(), runs: [], findings: [] };
    }

    const agentRows = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agentIds)));
    const agentNames = new Map(agentRows.map((a) => [a.id, a.name]));

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Denominator universe for pull_rate (AC-24): every 'done' run in the
    // window belonging to one of the currently-linking agents, regardless of
    // whether that particular run pulled this skill.
    const runRows = await this.db
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        costUsd: t.agentRuns.costUsd,
        findingsCount: t.agentRuns.findingsCount,
        skillIds: t.agentRuns.skillIds,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          inArray(t.agentRuns.agentId, agentIds),
          gte(t.agentRuns.ranAt, since),
          eq(t.agentRuns.status, 'done'),
        ),
      );

    const runs: SkillStatsRun[] = runRows.map((r) => ({
      id: r.id,
      agentId: r.agentId as string,
      costUsd: r.costUsd,
      findingsCount: r.findingsCount,
      skillIds: (r.skillIds as string[] | null) ?? null,
    }));

    // Numerator run set (AC-24/AC-25/AC-26): runs whose own skill_ids
    // actually contains this skill — "pulled", not just "linked".
    const pulledRunIds = runs.filter((r) => (r.skillIds ?? []).includes(skillId)).map((r) => r.id);

    // AC-25/AC-26: findings for the reviews of exactly those runs, tagged
    // with their run_id so the pure aggregator can attribute cost/category
    // per-run (a run's own findingsCount, not a recount here).
    const findingRows = pulledRunIds.length
      ? await this.db
          .select({
            runId: t.reviews.runId,
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
            dismissedAt: t.findings.dismissedAt,
          })
          .from(t.findings)
          .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
          .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, pulledRunIds)))
      : [];
    const findings: SkillStatsFinding[] = findingRows.map((f) => ({
      runId: f.runId as string,
      category: f.category,
      acceptedAt: f.acceptedAt,
      dismissedAt: f.dismissedAt,
    }));

    return { agentIds, agentNames, runs, findings };
  }
}
