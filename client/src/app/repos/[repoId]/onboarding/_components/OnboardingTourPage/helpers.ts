import type { OnboardingSection } from "@devdigest/shared";
import { ONBOARDING_SECTION_KINDS, type OnboardingSectionKind } from "./constants";

/** DOM id for a section card / "ON THIS PAGE" anchor-nav target. */
export function sectionId(kind: string): string {
  return `onboarding-section-${kind}`;
}

/**
 * Sections present in the response, reordered into the fixed canonical
 * `ONBOARDING_SECTION_KINDS` order — never trust the API's own array order
 * for display (the "ON THIS PAGE" nav and the card stack must always agree
 * on the same five-kind sequence).
 */
export function orderedSections(
  sections: OnboardingSection[],
): { kind: OnboardingSectionKind; section: OnboardingSection }[] {
  const byKind = new Map(sections.map((sec) => [sec.kind, sec]));
  return ONBOARDING_SECTION_KINDS.filter((k) => byKind.has(k)).map((k) => ({
    kind: k,
    section: byKind.get(k)!,
  }));
}

/**
 * Coarse "N ago" relative-time string for the `lastRefreshed` copy. No i18n
 * plural handling — matches this app's existing terse timestamp conventions
 * (e.g. `ReviewRunAccordion`'s `formatWhen`).
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Math.max(0, now - then);
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
