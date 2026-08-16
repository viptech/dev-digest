import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project Context (SPEC-01) — data access for `agent_context_docs` and
 * `skill_context_docs`. Mirrors `AgentsRepository`'s `agent_skills` shape
 * (composite key + `order`, delete-all + bulk-insert replace-whole-set), but
 * keyed on (owner, repo_id, path) — never (owner, path); AC-10.
 *
 * Reads `repos` directly for the owner/name join and the workspace-ownership
 * check, same as `repo-intel/repository.ts`'s `getRepoBasics` and
 * `reviews/repository.ts` already do outside `modules/repos/` — reading a
 * foreign table for a join/lookup is normal per-module practice here, not a
 * violation of `repos/repository.ts`'s "the ONLY place that touches `repos`"
 * comment (which is about repos' own lifecycle writes, not cross-module reads).
 */

export interface RepoForContext {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

/** One attached document, joined with its repo's owner/name for display. */
export interface ContextDocRow {
  repoId: string;
  path: string;
  order: number;
  owner: string;
  name: string;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  async getRepoForContext(repoId: string): Promise<RepoForContext | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  // ---- agent_context_docs --------------------------------------------------

  async listAgentDocs(agentId: string): Promise<ContextDocRow[]> {
    return this.db
      .select({
        repoId: t.agentContextDocs.repoId,
        path: t.agentContextDocs.path,
        order: t.agentContextDocs.order,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.agentContextDocs)
      .innerJoin(t.repos, eq(t.agentContextDocs.repoId, t.repos.id))
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
  }

  /**
   * Replace the agent's whole attached-doc set with `docs`, in that order
   * (`order` = array index) — same replace-whole-ordered-set pattern as
   * `AgentsRepository.setSkills`.
   */
  async setAgentDocs(
    agentId: string,
    docs: { repoId: string; path: string }[],
  ): Promise<void> {
    await this.db.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
    if (docs.length === 0) return;
    await this.db
      .insert(t.agentContextDocs)
      .values(docs.map((d, i) => ({ agentId, repoId: d.repoId, path: d.path, order: i })));
  }

  // ---- skill_context_docs ---------------------------------------------------

  async listSkillDocs(skillId: string): Promise<ContextDocRow[]> {
    return this.db
      .select({
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.skillContextDocs)
      .innerJoin(t.repos, eq(t.skillContextDocs.repoId, t.repos.id))
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
  }

  async setSkillDocs(
    skillId: string,
    docs: { repoId: string; path: string }[],
  ): Promise<void> {
    await this.db.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (docs.length === 0) return;
    await this.db
      .insert(t.skillContextDocs)
      .values(docs.map((d, i) => ({ skillId, repoId: d.repoId, path: d.path, order: i })));
  }

  // ---- usage (Project Context page's "Used by N agents" / "N skills") ------

  /**
   * Direct-attachment counts per path, scoped to one repo — agent-level and
   * skill-level counted INDEPENDENTLY (neither folds into the other; no
   * skill-transitive "effectively used by N agents through a linked skill"
   * count — that stays out of scope, per SPEC-01's original OQ7 decision).
   * Both counts are surfaced on the Project Context page now: showing only
   * the agent count made a doc attached solely to a skill (e.g. this repo's
   * own `client/INSIGHTS.md`) look completely unused, which read as a bug.
   */
  async usageCounts(repoId: string): Promise<Map<string, { agents: number; skills: number }>> {
    const [agentRows, skillRows] = await Promise.all([
      this.db
        .select({ path: t.agentContextDocs.path, count: sql<number>`count(*)` })
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.repoId, repoId))
        .groupBy(t.agentContextDocs.path),
      this.db
        .select({ path: t.skillContextDocs.path, count: sql<number>`count(*)` })
        .from(t.skillContextDocs)
        .where(eq(t.skillContextDocs.repoId, repoId))
        .groupBy(t.skillContextDocs.path),
    ]);
    const usage = new Map<string, { agents: number; skills: number }>();
    for (const r of agentRows) usage.set(r.path, { agents: Number(r.count), skills: 0 });
    for (const r of skillRows) {
      const existing = usage.get(r.path);
      if (existing) existing.skills = Number(r.count);
      else usage.set(r.path, { agents: 0, skills: Number(r.count) });
    }
    return usage;
  }
}
