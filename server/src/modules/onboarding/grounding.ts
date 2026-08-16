import type { OnboardingSection } from '@devdigest/shared';

/**
 * onboarding's own local grounding gate — a small, deliberate style-mirror of
 * `reviewer-core/src/grounding.ts`'s shape, NOT a call into that module (it
 * only ever grounds diff-findings against a `UnifiedDiff`, not arbitrary
 * file-path lists — root `CLAUDE.md`'s "never re-implemented as parallel
 * mechanisms" rule is about reusing the CONCEPT/style, not literally
 * importing that module for a shape it doesn't support).
 *
 * Design decision (documented explicitly, see the Development Plan's
 * Constraints section): AC-6's EARS text says an ungrounded `links[].path` /
 * `tasks[].path` has its "path ignored" while the label/title stays. This
 * function overwrites `path` with `''` when a path is not in `knownPaths` —
 * for BOTH `links[]` and `tasks[]` — before persistence. It NEVER drops the
 * surrounding link/task entry, only blanks its `path`.
 */
export function groundOnboardingSections(
  sections: OnboardingSection[],
  knownPaths: Set<string>,
): OnboardingSection[] {
  return sections.map((section) => ({
    ...section,
    links: section.links.map((link) =>
      knownPaths.has(link.path) ? link : { ...link, path: '' },
    ),
    tasks: section.tasks?.map((task) =>
      knownPaths.has(task.path) ? task : { ...task, path: '' },
    ),
  }));
}
