/**
 * Project Context (SPEC-01) HTTP module.
 *
 *   GET  /repos/:id/context/docs           → discovery list for that repo (AC-1, AC-2, AC-3)
 *   GET  /repos/:id/context/docs/content   → full text of one document (AC-4's Preview action)
 *   GET  /agents/:id/context-docs          → an agent's attached docs, ordered (AC-4a)
 *   POST /agents/:id/context-docs          → set/reorder the whole set (AC-4b, AC-6, AC-15)
 *   GET  /skills/:id/context-docs          → a skill's attached docs, ordered (AC-7)
 *   POST /skills/:id/context-docs          → set/reorder the whole set (AC-7, AC-15)
 *
 * No endpoint for "list connected repos" — reuse the existing `GET /repos`.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

const SetContextDocsBody = z.object({
  docs: z.array(z.object({ repo_id: z.string().uuid(), path: z.string().min(1) })),
});

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/context/docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const docs = await service.discoverForRepo(workspaceId, req.params.id);
    if (docs === undefined) throw new NotFoundError('Repo not found');
    return docs;
  });

  app.get(
    '/repos/:id/context/docs/content',
    { schema: { params: IdParams, querystring: z.object({ path: z.string().min(1) }) } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.readDocContent(workspaceId, req.params.id, req.query.path);
      if (!result) throw new NotFoundError('Document not found');
      return result;
    },
  );

  app.get('/agents/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const docs = await service.listAgentDocs(workspaceId, req.params.id);
    if (docs === undefined) throw new NotFoundError('Agent not found');
    return docs;
  });

  app.post(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.setAgentDocs(workspaceId, req.params.id, req.body.docs);
      if (!result) throw new NotFoundError('Agent not found');
      if (!result.ok) {
        throw new ValidationError('One or more context docs were rejected', {
          rejected: result.rejected,
        });
      }
      return result.docs;
    },
  );

  app.get('/skills/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const docs = await service.listSkillDocs(workspaceId, req.params.id);
    if (docs === undefined) throw new NotFoundError('Skill not found');
    return docs;
  });

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.setSkillDocs(workspaceId, req.params.id, req.body.docs);
      if (!result) throw new NotFoundError('Skill not found');
      if (!result.ok) {
        throw new ValidationError('One or more context docs were rejected', {
          rejected: result.rejected,
        });
      }
      return result.docs;
    },
  );
}
