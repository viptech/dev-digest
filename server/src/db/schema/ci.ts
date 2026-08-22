import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    /** Semantic version of the generated workflow template (e.g. "1.0.0"),
     *  bumped whenever `workflow.ts`'s output changes — informational only,
     *  shown on the CI tab's installations list (AC-33). Not a content hash. */
    workflowVersion: text('workflow_version'),
  },
  (t) => ({
    agentRepoTargetUnique: uniqueIndex('ci_installations_agent_repo_target_unique').on(
      t.agentId,
      t.repo,
      t.targetType,
    ),
  }),
);

export const ciRuns = pgTable('ci_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  prNumber: integer('pr_number'),
  ranAt: timestamp('ran_at', { withTimezone: true }),
  status: text('status'),
  findingsCount: integer('findings_count'),
  costUsd: doublePrecision('cost_usd'),
  githubUrl: text('github_url'),
  source: text('source'),
  /** `CiResultArtifact.commit_sha` — verified against the GitHub run's own
   *  `head_sha` at ingest time (AC-26), never trusted from the JSON alone. */
  commitSha: text('commit_sha'),
  model: text('model'),
  agentVersion: integer('agent_version'),
  durationS: doublePrecision('duration_s'),
  critical: integer('critical'),
  warning: integer('warning'),
  suggestion: integer('suggestion'),
});
