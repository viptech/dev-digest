/**
 * SPEC-01 (Project Context) — the "SERIALIZES AS" illustrative preview
 * (mockup: Skill Editor · Context tab). Display-only: the real union-into-
 * `## Project context` behavior is entirely server-side
 * (`ReviewRunExecutor.buildProjectContextDigest`) — this never reproduces
 * that, it's just a human-readable "what does this skill contribute" hint.
 *
 * Moved verbatim from `SkillDrawer/helpers.ts` (Development Plan
 * `skill-editor.md` Step 7.3, AC-10) — the drawer's "edit" mode (and this
 * block along with it) was removed in Step 6; this tab is its only caller
 * now.
 */
export function serializesAs(docs: { path: string }[]): string {
  if (docs.length === 0) return "## Project specifications\n(none attached)";
  return `## Project specifications\n${docs.map((d) => `- ${d.path}`).join("\n")}`;
}
