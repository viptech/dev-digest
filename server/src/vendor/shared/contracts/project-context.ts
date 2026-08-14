import { z } from 'zod';

/**
 * Project Context (SPEC-01) — manual, per-agent/per-skill attachment of `.md`
 * documents discovered anywhere in a connected repo's local clone. See
 * `docs/specs/SPEC-01-project-context.md`. Originally scoped to `specs/`,
 * `docs/`, `insights/` only; broadened to every `.md` file in the repo — the
 * fixed-root scope silently missed real files (e.g. this very repo's own
 * root-level `INSIGHTS.md`, which has no `insights/` ancestor DIRECTORY, just
 * that name as its filename). A doc under one of the three original roots
 * keeps that category label; every other `.md` file is `'other'`.
 *
 * NOTE: `PromptAssembly.specs` / `RunTrace.specs_read` (contracts/trace.ts)
 * already carry this feature's runtime output — no new field there, only new
 * *values* (repo-qualified `"<owner>/<name>:<path>"` strings, AC-16).
 */

export const ProjectContextCategory = z.enum(['specs', 'docs', 'insights', 'other']);
export type ProjectContextCategory = z.infer<typeof ProjectContextCategory>;

/** One markdown document discovered in a repo's local clone (AC-1, AC-2). */
export const ProjectContextDoc = z.object({
  path: z.string(),
  category: ProjectContextCategory,
  /** Byte size (stat, not a content read) — feeds the UI's live
   *  `ceil(chars/4)` token estimate while attaching (AC-5); never the
   *  authoritative size used for the actual run-time injection cap. */
  chars: z.number().int(),
  /** Direct-attachment count on agents only — no skill-transitive join (Goals). */
  used_by_agents: z.number().int(),
});
export type ProjectContextDoc = z.infer<typeof ProjectContextDoc>;

/**
 * A document attached to an agent's Context tab. `order` is the position in
 * the agent's own, single cross-repo ordered list (AC-4a, AC-6). `owner`/
 * `name` are the doc's repo, joined in for display — the row itself is keyed
 * by (agent_id, repo_id, path), never (agent_id, path) (AC-10).
 */
export const AgentContextDocLink = z.object({
  agent_id: z.string(),
  repo_id: z.string(),
  path: z.string(),
  order: z.number().int(),
  owner: z.string(),
  name: z.string(),
});
export type AgentContextDocLink = z.infer<typeof AgentContextDocLink>;

/** Same shape as `AgentContextDocLink`, keyed by skill instead of agent (AC-7). */
export const SkillContextDocLink = z.object({
  skill_id: z.string(),
  repo_id: z.string(),
  path: z.string(),
  order: z.number().int(),
  owner: z.string(),
  name: z.string(),
});
export type SkillContextDocLink = z.infer<typeof SkillContextDocLink>;

/** Body for POST /agents/:id/context-docs and POST /skills/:id/context-docs —
 *  the whole ordered set (index = order); the server assigns `order`. */
export const SetContextDocsBody = z.object({
  docs: z.array(z.object({ repo_id: z.string(), path: z.string() })),
});
export type SetContextDocsBody = z.infer<typeof SetContextDocsBody>;
