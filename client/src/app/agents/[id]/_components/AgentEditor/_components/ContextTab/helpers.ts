import type { AgentContextDocLink, SkillContextDocLink } from "@devdigest/shared";

/**
 * Combined "agent + enabled linked skills" attached-doc count (SPEC-02, T4).
 *
 * Mirrors `ProjectContextService.resolveAgentContext`'s dedup exactly
 * (`server/src/modules/project-context/service.ts:213-232`): walk the
 * agent's own docs first (in saved order), then each enabled linked skill's
 * docs in link order (each skill's own saved doc order), and dedupe on
 * `(repo_id, path)` keeping the FIRST occurrence overall. This is a
 * seen-set/first-occurrence-wins walk, NOT a naive `own.length + Σ skill
 * lengths` sum — that would double-count a doc attached both on the agent
 * and via a linked skill (AC-26), or shared by two different linked skills.
 */
export function aggregateContextDocCount(
  ownDocs: AgentContextDocLink[],
  linkedSkillIdsInOrder: string[],
  skillDocsById: Map<string, SkillContextDocLink[]>,
): { own: number; fromSkills: number; total: number } {
  const seen = new Set<string>();

  let own = 0;
  for (const doc of ownDocs) {
    const key = `${doc.repo_id}:${doc.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    own++;
  }

  let fromSkills = 0;
  for (const skillId of linkedSkillIdsInOrder) {
    const docs = skillDocsById.get(skillId) ?? [];
    for (const doc of docs) {
      const key = `${doc.repo_id}:${doc.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fromSkills++;
    }
  }

  return { own, fromSkills, total: own + fromSkills };
}
