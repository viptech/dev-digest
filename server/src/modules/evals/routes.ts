import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalExpectation } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsService } from './service.js';

/**
 * Evals module (per-agent AND per-skill eval cases — SPEC-06 generalizes
 * ownerKind to `'skill'` alongside the original `'agent'`).
 *   GET    /agents/:id/evals             → list this agent's eval cases (each
 *                                           with a `last_run` summary)
 *   POST   /agents/:id/evals             → create one
 *   PUT    /agents/:id/evals/:caseId     → update (owner-scoped to :id)
 *   DELETE /agents/:id/evals/:caseId     → delete (owner-scoped to :id)
 *   POST   /agents/:id/evals/:caseId/run → run it, persist an eval_runs row
 *   GET    /agents/:id/eval-runs         → set-run history, newest first (AC-17)
 *   POST   /agents/:id/eval-runs         → run the WHOLE set, one run_group_id (AC-11)
 *   GET    /eval-dashboard               → workspace-wide, per-agent latest set-run (AC-20,
 *                                           unchanged by SPEC-06 — agent-only, never sees
 *                                           skill-owned rows, see `dashboard()`)
 *
 *   GET    /skills/:id/evals             → same shape, ownerKind: 'skill' (SPEC-06 T7)
 *   POST   /skills/:id/evals
 *   PUT    /skills/:id/evals/:caseId
 *   DELETE /skills/:id/evals/:caseId
 *   POST   /skills/:id/evals/:caseId/run → runs the skill-under-test's CURRENT body
 *                                           against a synthetic in-memory config
 *                                           (SPEC-06 AC-14), regardless of `enabled`
 *                                           (AC-15) — see `EvalsService.resolveRunConfig`.
 *   GET    /skills/:id/eval-runs
 *   POST   /skills/:id/eval-runs         → same bulk-cost rate limit as the agent
 *                                           route (AC-18)
 *
 * Every `/skills/:id/...` handler resolves `:id` against `skillsRepo.getById`
 * (workspace-scoped) BEFORE calling into `EvalsService` — 404 on a
 * foreign-workspace/unknown skill precedes any DB write or LLM call (AC-19),
 * the same guard shape the agent routes above already apply via
 * `agentsRepo.getById`.
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
    return service.list(workspaceId, 'agent', req.params.id);
  });

  app.post(
    '/agents/:id/evals',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.create(workspaceId, 'agent', req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/agents/:id/evals/:caseId',
    { schema: { params: CaseParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, 'agent', req.params.id, req.params.caseId, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete(
    '/agents/:id/evals/:caseId',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.delete(workspaceId, 'agent', req.params.id, req.params.caseId);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/agents/:id/evals/:caseId/run',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.run(workspaceId, 'agent', req.params.id, req.params.caseId);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  // ---- Set-run history (AC-17) --------------------------------------------
  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listSetRuns(workspaceId, 'agent', req.params.id);
  });

  // ---- Bulk set-run (AC-11–AC-14, AC-22, AC-23) ----------------------------
  // Tighter than the single-run rate limit (unlimited today, a pre-existing
  // gap out of this spec's scope): bulk fans out to N LLM calls per request.
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.runSet(workspaceId, 'agent', req.params.id, req.log);
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  // ---- Eval Dashboard (AC-20/AC-21) — workspace-wide, no :repoId ----------
  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });

  // ---- Skill-owned eval routes (SPEC-06 T7) --------------------------------
  // Test a skill in isolation, before it's linked/enabled on any real agent
  // (AC-12/AC-14/AC-15). Every handler checks the skill belongs to the
  // caller's workspace BEFORE calling into EvalsService (AC-19) — same shape
  // as the agent routes' `agentsRepo.getById` guard above.
  const requireSkill = async (workspaceId: string, id: string) => {
    const skill = await app.container.skillsRepo.getById(workspaceId, id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  };

  app.get('/skills/:id/evals', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await requireSkill(workspaceId, req.params.id);
    return service.list(workspaceId, 'skill', req.params.id);
  });

  app.post(
    '/skills/:id/evals',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireSkill(workspaceId, req.params.id);
      const created = await service.create(workspaceId, 'skill', req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/skills/:id/evals/:caseId',
    { schema: { params: CaseParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireSkill(workspaceId, req.params.id);
      const updated = await service.update(workspaceId, 'skill', req.params.id, req.params.caseId, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete(
    '/skills/:id/evals/:caseId',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireSkill(workspaceId, req.params.id);
      const ok = await service.delete(workspaceId, 'skill', req.params.id, req.params.caseId);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/skills/:id/evals/:caseId/run',
    { schema: { params: CaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireSkill(workspaceId, req.params.id);
      const result = await service.run(workspaceId, 'skill', req.params.id, req.params.caseId);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  // ---- Set-run history (AC-17), skill-owned --------------------------------
  app.get('/skills/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await requireSkill(workspaceId, req.params.id);
    return service.listSetRuns(workspaceId, 'skill', req.params.id);
  });

  // ---- Bulk set-run, skill-owned (AC-18: same cost-abuse rate limit as the
  // agent route above — copied verbatim, not weakened for the skill path) --
  app.post(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireSkill(workspaceId, req.params.id);
      const result = await service.runSet(workspaceId, 'skill', req.params.id, req.log);
      if (!result) throw new NotFoundError('Skill not found');
      return result;
    },
  );
}
