import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { BlastRadius } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffRepository } from '../smart-diff/repository.js';
import { BlastService } from './service.js';

/**
 * Blast Radius module — GET /pulls/:id/blast.
 *
 * Given a PR's already-imported changed files, reports which symbols were
 * declared, who calls/imports them, and which HTTP endpoints/crons might be
 * affected — reusing the persistent `repo-intel` index (`container.repoIntel`,
 * never the concrete `RepoIntelService`). Deterministic: no LLM call anywhere
 * in this module, mirrors `smart-diff/routes.ts`'s exact shape.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const files = new SmartDiffRepository(container.db);
  const service = new BlastService(container, files);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
      if (!pr) throw new NotFoundError('Pull request not found');
      return service.build(pr.id, pr.repoId);
    },
  );
}
