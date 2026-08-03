import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                  → list (workspace-scoped)
 *   GET    /skills/:id              → one skill
 *   POST   /skills                  → create (source='manual')
 *   PUT    /skills/:id              → update (body change bumps version)
 *   DELETE /skills/:id              → delete
 *   POST   /skills/import/preview   → parse an uploaded .md file, NOT persisted
 *   POST   /skills/import           → persist a confirmed import
 *                                      (source='imported_url', enabled=false)
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

/** Only .md / .markdown filenames are accepted — no archives, no scripts. */
const MD_EXT = /\.(md|markdown)$/i;

const ImportPreviewBody = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

const ImportSaveBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType.optional(),
  body: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.post(
    '/skills/import/preview',
    { schema: { body: ImportPreviewBody } },
    async (req) => {
      await getContext(app.container, req);
      if (!MD_EXT.test(req.body.filename)) {
        throw new ValidationError('Only .md/.markdown files can be imported');
      }
      return service.importPreview(req.body.content);
    },
  );

  app.post('/skills/import', { schema: { body: ImportSaveBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.importSave(workspaceId, req.body);
    reply.status(201);
    return skill;
  });
}
