import { pgTable, uuid, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';
import { repos } from './repos';

/**
 * Project Context (SPEC-01) — manual attachment of `.md` documents (paths
 * only, never content — see spec's Inputs/provenance section) to an agent or
 * a skill. Mirrors `agent_skills`' composite-PK + `order` shape
 * (`./agents.ts`'s `agentSkills`), extended with `repo_id`: the key is
 * (owner, repo_id, path), NOT (owner, path) — the same repo-relative path in
 * two different repos is two distinct attachments (AC-10), never a dedup
 * target on `path` alone.
 */

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }) }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }) }),
);
