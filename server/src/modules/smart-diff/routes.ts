import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { SmartDiff } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffRepository } from './repository.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff module — GET /pulls/:id/smart-diff.
 *
 * Groups a PR's already-imported files by risk role (core/wiring/boilerplate)
 * and joins in the latest review's findings. Purely deterministic: a plain
 * HTTP read over `pr_files` + `reviews`/`findings`, no new external call and
 * NO LLM invocation anywhere in this module (no `resolveFeatureModel`, no
 * `container.llm(...)`) — see classification-rules.ts for the patterns and
 * thresholds the classifier uses.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repo = new SmartDiffRepository(container.db);
  const service = new SmartDiffService(repo);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(container, req);
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
      if (!pr) throw new NotFoundError('Pull request not found');
      return service.build(pr.id);
    },
  );
}
