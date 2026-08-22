import type { CiInstallation, CiRun, RepoRef } from '@devdigest/shared';
import { AppError, ValidationError } from '../../platform/errors.js';
import type { CiInstallationRow, CiRunListRow } from './repository.js';

/**
 * ci module — pure helpers (DTO mapping, error taxonomy, `owner/name` repo
 * parsing). No I/O, no container — mirrors the `agents`/`evals` modules'
 * `helpers.ts` shape.
 */

/** The exact `name:`/`path:` the generated workflow (`workflow.ts`) gives
 *  `actions/upload-artifact` — the ingest loop's (T6) polling target for
 *  `GitHubClient.listWorkflowRunsFor`/`downloadRunArtifact`. Kept here
 *  (shared by `service.ts`) rather than duplicated at each call site. */
export const CI_WORKFLOW_FILE = 'devdigest-review.yml';
export const CI_RESULT_ARTIFACT_NAME = 'devdigest-result';

/** AC-6: `target !== 'gha'` on any export-ci call is a 400, not the generic
 *  422 a zod `ValidationError` would produce (`server/INSIGHTS.md`'s
 *  "ValidationError -> 422" gotcha) — an explicit `AppError` subclass. */
export class UnsupportedCiTargetError extends AppError {
  constructor() {
    super('unsupported_ci_target', 'Only the GitHub Actions target is supported', 400);
  }
}

/**
 * Parse the wizard's free-text `"owner/name"` repo field into a `RepoRef`
 * for `GitHubClient`. This is a user-typed TARGET selector (which repo gets
 * the exported files), not diff/PR content — access control for it is
 * enforced by GitHub's own API against the studio's `GITHUB_TOKEN`
 * (Untrusted inputs section, SPEC-08), not by this parser. A malformed value
 * (no `/`, or an empty segment) is a client input error, not a 500.
 */
export function parseRepoSlug(repo: string): RepoRef {
  const parts = repo.split('/');
  const owner = parts[0];
  const name = parts[1];
  if (parts.length !== 2 || !owner || !name) {
    throw new ValidationError(`Expected "owner/name", got '${repo}'`);
  }
  return { owner, name };
}

/** Map a persisted `ci_installations` row to the public `CiInstallation` DTO. */
export function toCiInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiInstallation['target_type'],
    installed_at: row.installedAt.toISOString(),
    workflow_version: row.workflowVersion,
  };
}

/** Map a joined `ci_runs` row (+ resolved agent name) to the public `CiRun`
 *  DTO (T7/T8, AC-28/AC-33). `agentName: null` (installation/agent deleted)
 *  maps to `undefined` here — the client-visible "Agent" fallback text is a
 *  render-time decision, not something baked into the wire payload. */
export function toCiRunDto(row: CiRunListRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agentName ?? undefined,
    duration_s: row.durationS ?? undefined,
    critical: row.critical ?? undefined,
    warning: row.warning ?? undefined,
    suggestion: row.suggestion ?? undefined,
  };
}
