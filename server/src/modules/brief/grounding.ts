import type { Risk, ReviewFocusItem } from '@devdigest/shared';

/**
 * brief's own local grounding gate — a small, deliberate style-mirror of
 * `onboarding/grounding.ts` (itself a style-mirror of
 * `reviewer-core/src/grounding.ts`'s shape, NOT a call into that module — it
 * only ever grounds line-ranged diff findings against a `UnifiedDiff`, not
 * arbitrary path/endpoint lists).
 */

/** AC-5: an ungrounded `file_ref` is filtered out of that risk's array; if
 *  the array empties out, the WHOLE risk is dropped. `f.trim()` before
 *  matching — endpoint entries are `"METHOD /path"` strings the model must
 *  reproduce byte-for-byte (cross-model review finding m9); a trailing/
 *  leading space shouldn't cost an otherwise-correct citation its grounding.
 *  `knownUniverse` itself is built pre-trimmed by the caller
 *  (`risk-brief.ts`'s `assembleBriefInput`), so this is a defensive
 *  normalization on the model's side only. */
export function groundRisks(risks: Risk[], knownUniverse: Set<string>): Risk[] {
  return risks
    .map((r) => ({ ...r, file_refs: r.file_refs.filter((f) => knownUniverse.has(f.trim())) }))
    .filter((r) => r.file_refs.length > 0);
}

/** AC-6: an ungrounded review_focus item is dropped WHOLE (not blanked —
 *  unlike onboarding's links/tasks, a pathless review_focus row has no
 *  useful click target at all). */
export function groundReviewFocus(items: ReviewFocusItem[], changedPaths: Set<string>): ReviewFocusItem[] {
  return items.filter((i) => changedPaths.has(i.path.trim()));
}
