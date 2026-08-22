import { and, desc, eq, gte, isNull, max, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiTarget } from '@devdigest/shared';

/**
 * ci module data-access (SPEC-08). This file owns `ci_installations` writes
 * (T3/T4, Export Wizard Install step) AND `ci_runs` reads/writes + the
 * `agent_runs`(source='ci') twin insert (T6-T8, the ingest/polling half of
 * this same module).
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

/** A `ci_runs` row + the display-only agent name resolved through
 *  `ci_installations.agent_id -> agents.name` (T7/T8's shared row shape,
 *  AC-28/AC-33). `agentName` is `null` when `ci_installation_id` is itself
 *  `null` (agent/installation deleted — Edge case) — the "Agent" fallback
 *  text itself is a client concern (`helpers.ts`/client render), this just
 *  passes the real absence through undecorated. */
export interface CiRunListRow extends CiRunRow {
  agentName: string | null;
}

export interface UpsertCiInstallation {
  agentId: string;
  repo: string;
  targetType: CiTarget;
  workflowVersion: string;
}

export interface InsertCiRun {
  ciInstallationId: string;
  prNumber: number | null;
  ranAt: Date;
  status: string;
  findingsCount: number;
  costUsd: number | null;
  githubUrl: string;
  source: string;
  commitSha: string;
  model: string;
  agentVersion: number | null;
  durationS: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
}

export interface InsertCiAgentRun {
  workspaceId: string;
  agentId: string;
  ranAt: Date;
  model: string;
  durationMs: number | null;
  costUsd: number | null;
  findingsCount: number;
}

export interface ListCiRunsFilter {
  workspaceId: string;
  since?: Date;
  agentId?: string;
  repo?: string;
  status?: string;
  source?: string;
}

export class CiRepository {
  constructor(private db: Db) {}

  /**
   * Insert-or-update on the `(agent_id, repo, target_type)` unique index
   * (AC-4): a repeat "Update CI config" for the same agent/repo/target
   * replaces the existing row's `workflow_version` in place — never a second
   * installation row for the same triple.
   */
  async upsertInstallation(values: UpsertCiInstallation): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: values.agentId,
        repo: values.repo,
        targetType: values.targetType,
        workflowVersion: values.workflowVersion,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo, t.ciInstallations.targetType],
        set: { workflowVersion: values.workflowVersion },
      })
      .returning();
    return row!;
  }

  /** An installation + its owning agent's `workspaceId` — the only way to
   *  resolve tenancy starting from a bare installation id (T6's
   *  `refreshInstallation`, no caller-supplied `workspaceId` to trust). */
  async getInstallationWithWorkspace(
    id: string,
  ): Promise<{ installation: CiInstallationRow; workspaceId: string } | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations, workspaceId: t.agents.workspaceId })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.ciInstallations.id, id));
    return row;
  }

  /** Every installation for one agent (T8's "installations list", AC-33). */
  async listInstallationsForAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentId));
  }

  /** Every installation belonging to ANY agent in `workspaceId` (T6's
   *  `refreshAll` — the set of installations one "Refresh" call polls). */
  async listInstallationsForWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows.map((r) => r.installation);
  }

  /** Most recent `ran_at` already persisted for this installation, or
   *  `null` when it has none yet — T6's "only process runs newer than this"
   *  dedup boundary (no other unique key links a GitHub run to a `ci_runs`
   *  row, per the Development Plan's Constraints on this open question). */
  async lastRanAt(ciInstallationId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ maxRanAt: max(t.ciRuns.ranAt) })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, ciInstallationId));
    return row?.maxRanAt ?? null;
  }

  async insertRun(values: InsertCiRun): Promise<CiRunRow> {
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: values.ciInstallationId,
        prNumber: values.prNumber,
        ranAt: values.ranAt,
        status: values.status,
        findingsCount: values.findingsCount,
        costUsd: values.costUsd,
        githubUrl: values.githubUrl,
        source: values.source,
        commitSha: values.commitSha,
        model: values.model,
        agentVersion: values.agentVersion,
        durationS: values.durationS,
        critical: values.critical,
        warning: values.warning,
        suggestion: values.suggestion,
      })
      .returning();
    return row!;
  }

  /**
   * `agent_runs`(source='ci') twin write (AC-24). Kept here rather than
   * reused from `reviews/repository.ts`'s `createAgentRun` because that
   * helper requires a non-null `prId` (a `pull_requests` row in THIS
   * studio) — a CI target repo is typically not onboarded into
   * `pull_requests` at all, so `prId` must be `null` here.
   */
  async insertAgentRun(values: InsertCiAgentRun): Promise<void> {
    await this.db.insert(t.agentRuns).values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: null,
      ranAt: values.ranAt,
      provider: null,
      model: values.model,
      durationMs: values.durationMs,
      tokensIn: null,
      tokensOut: null,
      costUsd: values.costUsd,
      status: 'done',
      source: 'ci',
      findingsCount: values.findingsCount,
      grounding: null,
      score: null,
      blockers: null,
      skillIds: null,
    });
  }

  /** DISTINCT `ci_installations.repo` for a workspace — the CI Runs page's
   *  "All repos" filter (AC-30); never a new column on `ci_runs` itself. */
  async listDistinctRepos(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ repo: t.ciInstallations.repo })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows.map((r) => r.repo);
  }

  /**
   * Workspace-scoped `ci_runs` read (T7 `GET /ci/runs`; T8 `GET
   * /agents/:id/ci` via `filter.agentId`, narrowing to one agent's
   * installations). LEFT JOINs so a row whose `ci_installation_id` was set
   * null (agent/installation deleted, cascade — `ci.ts:6-8,16-18`) still
   * comes back with `agentName: null` (AC-28's Edge case: "stays visible").
   *
   * Once `ci_installation_id` is null, NO column on `ci_runs` links the row
   * back to a workspace any more — there is no workspace-scoping way to
   * both keep it visible AND exclude it from other workspaces in a
   * multi-tenant sense. This app is single-tenant MVP
   * (`LocalNoAuthProvider` — one seeded workspace), so the `isNull(...)`
   * branch below deliberately does not also require `workspaceId` to match
   * — it satisfies AC-28's literal "stays visible" requirement rather than
   * inventing a stricter scoping AC-28 never asked for.
   */
  async listRuns(filter: ListCiRunsFilter): Promise<CiRunListRow[]> {
    const conditions = [
      or(eq(t.agents.workspaceId, filter.workspaceId), isNull(t.ciRuns.ciInstallationId)),
    ];
    if (filter.since) conditions.push(gte(t.ciRuns.ranAt, filter.since));
    if (filter.agentId) conditions.push(eq(t.ciInstallations.agentId, filter.agentId));
    if (filter.repo) conditions.push(eq(t.ciInstallations.repo, filter.repo));
    if (filter.status) conditions.push(eq(t.ciRuns.status, filter.status));
    if (filter.source) conditions.push(eq(t.ciRuns.source, filter.source));

    const rows = await this.db
      .select({ run: t.ciRuns, agentName: t.agents.name })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .leftJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(...conditions))
      .orderBy(desc(t.ciRuns.ranAt));

    return rows.map((r) => ({ ...r.run, agentName: r.agentName ?? null }));
  }
}
