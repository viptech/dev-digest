import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CiService } from './service.js';

const ListCiRunsQuery = z.object({
  since: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
});

/**
 * ci module (SPEC-08 — Export to CI).
 *   POST /agents/:id/export-ci   {repo, target, action, post_as, triggers, base}
 *                                → Preview (`action:'files'`, no side effects,
 *                                  AC-7/AC-10/AC-20) or Install (`action:'open_pr'`,
 *                                  commits + opens/reuses a PR, upserts
 *                                  `ci_installations`, AC-18-AC-21).
 *   GET  /ci/runs                → workspace-scoped CI run history + filters
 *                                  (since/agent_id/repo/status/source) + the
 *                                  distinct-repo list for "All repos" (AC-28, AC-30).
 *   GET  /agents/:id/ci          → this agent's installations + `ci_fail_on`
 *                                  passthrough + its own run history (AC-31-AC-33).
 *   POST /ci/refresh             → trigger the PULL-model ingest cycle for every
 *                                  installation in the workspace (AC-24).
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  // Tight per-route limit (AC-34): each call can commit files + open a PR on
  // the caller's behalf — same pattern/number as `reviews/routes.ts:33,65`.
  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const result = await service.exportCi(workspaceId, req.params.id, {
        repo: body.repo,
        target: body.target,
        action: body.action,
        postAs: body.post_as,
        triggers: body.triggers,
        base: body.base,
        fileOverrides: body.file_overrides,
      });
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  // ---- CI Runs (T7, AC-28/AC-30) ------------------------------------------
  app.get('/ci/runs', { schema: { querystring: ListCiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = req.query;
    return service.listRuns(workspaceId, {
      ...(q.since !== undefined ? { since: q.since } : {}),
      ...(q.agent_id !== undefined ? { agentId: q.agent_id } : {}),
      ...(q.repo !== undefined ? { repo: q.repo } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.source !== undefined ? { source: q.source } : {}),
    });
  });

  // ---- CI tab of one agent (T8, AC-31-AC-33) ------------------------------
  app.get('/agents/:id/ci', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.getAgentCi(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Agent not found');
    return result;
  });

  // ---- Trigger the PULL-model ingest cycle (T6/T9, AC-24/AC-34) ----------
  // Same tight per-route limit as export-ci: each call fans out to N GitHub
  // API calls (one `listWorkflowRunsFor` + one `downloadRunArtifact` per new
  // run, per installation in the workspace).
  app.post(
    '/ci/refresh',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.refreshAll(workspaceId, req.log);
    },
  );
}
