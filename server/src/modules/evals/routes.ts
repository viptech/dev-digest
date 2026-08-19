import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalExpectation } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsService } from './service.js';

/**
 * Evals module (per-agent eval cases).
 *   GET    /agents/:id/evals             → list this agent's eval cases (each
 *                                           with a `last_run` summary)
 *   POST   /agents/:id/evals             → create one
 *   PUT    /agents/:id/evals/:caseId     → update (owner-scoped to :id)
 *   DELETE /agents/:id/evals/:caseId     → delete (owner-scoped to :id)
 *   POST   /agents/:id/evals/:caseId/run → run it, persist an eval_runs row
 *   GET    /agents/:id/eval-runs         → set-run history, newest first (AC-17)
 *   POST   /agents/:id/eval-runs         → run the WHOLE set, one run_group_id (AC-11)
 *   GET    /eval-dashboard               → workspace-wide, per-agent latest set-run (AC-20)
 */

const CreateEvalCaseBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().optional(),
  input_meta: z.unknown().optional(),
  expected_output: z.array(EvalExpectation).optional(),
  notes: z.string().optional(),
});

const UpdateEvalCaseBody = CreateEvalCaseBody.partial();

const CaseParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  app.get('/agents/:id/evals', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/evals',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.create(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/agents/:id/evals/:caseId',
    { schema: { params: CaseParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.params.caseId, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete(
    '/agents/:id/evals/:caseId',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.delete(workspaceId, req.params.id, req.params.caseId);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/agents/:id/evals/:caseId/run',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.run(workspaceId, req.params.id, req.params.caseId);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  // ---- Set-run history (AC-17) --------------------------------------------
  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listSetRuns(workspaceId, req.params.id);
  });

  // ---- Bulk set-run (AC-11–AC-14, AC-22, AC-23) ----------------------------
  // Tighter than the single-run rate limit (unlimited today, a pre-existing
  // gap out of this spec's scope): bulk fans out to N LLM calls per request.
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.runSet(workspaceId, req.params.id, req.log);
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  // ---- Eval Dashboard (AC-20/AC-21) — workspace-wide, no :repoId ----------
  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });
}
