import type { FastifyInstance } from 'fastify';
import { truncateText } from './format.js';

/**
 * Demo-only module for the L04 Blast Radius acceptance-criteria video: this
 * route calls the shared `truncateText` helper directly, so the blast map
 * for a change to that helper has a real HTTP endpoint alongside the two
 * service callers (commentService.ts, notificationService.ts).
 */
export default async function demoCommentPreviewRoutes(app: FastifyInstance) {
  app.post<{ Body: { text: string } }>('/demo/comments/preview', async (req) => {
    return { preview: truncateText(req.body.text, 200) };
  });
}
