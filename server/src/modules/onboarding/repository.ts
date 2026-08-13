import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * onboarding repository — data access for the `onboarding` table (jsonb
 * `json` column + `generated_at`; PK = `repo_id`, migration `0000_init.sql`).
 * Workspace-scoping read mirrors `project-context/repository.ts`'s
 * `getRepoForContext` (root `CLAUDE.md`'s workspace-scoping precedent).
 */

export interface RepoForOnboarding {
  id: string;
  workspaceId: string;
}

export interface OnboardingRow {
  repoId: string;
  json: unknown;
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async getRepoForOnboarding(repoId: string): Promise<RepoForOnboarding | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  async getByRepoId(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db
      .select({ repoId: t.onboarding.repoId, json: t.onboarding.json, generatedAt: t.onboarding.generatedAt })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /**
   * INSERT ... ON CONFLICT (repo_id) DO UPDATE — called ONLY from the
   * non-degraded success path of `service.generate()` (AC-12; a degraded/
   * failed-call skeleton is NEVER persisted — see the Development Plan's
   * "AC-12 vs. degraded persistence" note).
   */
  async upsert(repoId: string, values: { json: unknown; generatedAt: Date }): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: values.json, generatedAt: values.generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: values.json, generatedAt: values.generatedAt },
      });
  }
}
