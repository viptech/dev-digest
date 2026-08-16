import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { OnboardingService } from './service.js';

/**
 * onboarding module (SPEC-03).
 *   GET  /repos/:repoId/onboarding            → persisted tour, 404 if absent/not-owned
 *   POST /repos/:repoId/onboarding/generate    → generate (+ persist on success)
 *
 * Own `RepoParams` (not the generic `IdParams`) — this module is exclusively
 * repo-scoped, same precedent as `conventions/routes.ts:16`.
 */
const RepoParams = z.object({ repoId: z.string().uuid() });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container);

  app.get('/repos/:repoId/onboarding', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.get(workspaceId, req.params.repoId);
    if (!result) throw new NotFoundError('Onboarding tour not found');
    return result;
  });

  app.post(
    '/repos/:repoId/onboarding/generate',
    {
      schema: { params: RepoParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // A degraded-but-handled generation (AC-8/AC-9) is still a 200 with
      // `degraded: true` in the body — NEVER a 4xx/5xx. Only an unowned/
      // missing repo throws (404).
      const result = await service.generate(workspaceId, req.params.repoId, req.log);
      if (!result) throw new NotFoundError('Repo not found');
      return result;
    },
  );
}
