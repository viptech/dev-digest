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
 * Brief module — GET /pulls/:id/brief.
 *
 * Deterministic PR-level rollup (verdict/score/blockers/findings/cost/tokens)
 * for the Overview tab's "PR Brief" card. No LLM anywhere in this module yet
 * — see `docs/2026-08-07-pr-brief-plan.md` for the later Risk Areas / prior-
 * PRs increments.
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
      return service.build(pr.id, workspaceId);
    },
  );
}
