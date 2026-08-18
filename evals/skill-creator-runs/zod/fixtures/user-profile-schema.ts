import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { userProfiles } from '../db/schema.js';

const UserProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  metadata: z.any(),
  timezone: z.string().default('UTC'),
});

type UserProfileInput = {
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  metadata: unknown;
  timezone: string;
};

export default async function profileRoutes(app: FastifyInstance) {
  app.put('/me/profile', async (req, reply) => {
    const input = UserProfileSchema.parse(req.body) as UserProfileInput;

    const [row] = await db
      .insert(userProfiles)
      .values({
        userId: req.userId,
        displayName: input.displayName,
        bio: input.bio ?? null,
        avatarUrl: input.avatarUrl ?? null,
        metadata: input.metadata,
        timezone: input.timezone,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          displayName: input.displayName,
          bio: input.bio ?? null,
          avatarUrl: input.avatarUrl ?? null,
          metadata: input.metadata,
          timezone: input.timezone,
        },
      })
      .returning();

    reply.status(200);
    return row;
  });

  app.get('/me/profile', async (req, reply) => {
    const [row] = await db.select().from(userProfiles).where((t) => t.userId === req.userId);
    if (!row) {
      reply.status(404);
      return { error: 'Profile not found' };
    }
    return row;
  });
}
