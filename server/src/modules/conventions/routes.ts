import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module.
 *   GET  /repos/:repoId/conventions          → list candidates for a repo
 *   POST /repos/:repoId/conventions/extract  → run the 2-step LLM extraction
 *   PUT  /conventions/:id                    → accept/reject/edit one candidate
 */

const RepoParams = z.object({ repoId: z.string().uuid() });

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  accepted: z.boolean().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:repoId/conventions', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.repoId);
  });

  app.post(
    '/repos/:repoId/conventions/extract',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.repoId, req.log);
    },
  );

  app.put(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention candidate not found');
      return updated;
    },
  );
}
