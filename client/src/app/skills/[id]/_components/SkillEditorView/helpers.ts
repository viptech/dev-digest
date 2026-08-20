import type { Skill } from "@devdigest/shared";

/** Moved here from the now-deleted `SkillsListView/helpers.ts` — that grid
 *  page was replaced by `/skills` redirecting straight into this route
 *  (see `skills/page.tsx`), so this view is the only remaining caller.
 *  Demoted back to feature-local per the "second user" rule now that it
 *  only has one (`react-ui-architecture` skill). */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
}
