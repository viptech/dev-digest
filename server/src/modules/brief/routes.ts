import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { PrBriefSnapshot } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BriefService } from './service.js';

/**
 * Brief module.
 *   GET  /pulls/:id/brief — cached snapshot (review_rollup, deterministic;
 *        brief, LLM-synthesized — read-only, no LLM call, AC-8).
 *   POST /pulls/:id/brief — generate/regenerate the LLM-synthesized `brief`
 *        (AC-9, rate-limited, AC-15).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<PrBriefSnapshot> => {
      const { workspaceId } = await getContext(container, req);
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
      if (!pr) throw new NotFoundError('Pull request not found');
      return service.build(pr, workspaceId);
    },
  );

  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrBriefSnapshot> => {
      const { workspaceId } = await getContext(container, req);
      // Workspace/PR ownership check BEFORE any model resolution/LLM call
      // (AC-12) — a degraded-but-handled generation (AC-13) is still a 200
      // with `brief_degraded: true` in the body; only a missing/unowned PR
      // or repo throws (404).
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
      if (!pr) throw new NotFoundError('Pull request not found');
      const [repoRow] = await container.db
        .select({ id: t.repos.id, owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(eq(t.repos.id, pr.repoId));
      if (!repoRow) throw new NotFoundError('Repo not found');
      return service.generate(pr, repoRow, workspaceId, req.log);
    },
  );
}
