import type { IconName } from "@devdigest/ui";
import type { OnboardingDegradedReason } from "@devdigest/shared";

/** Fixed five `kind` identifiers, in fixed display order (mirrors the
 *  server's `ONBOARDING_SECTION_KINDS`). */
export const ONBOARDING_SECTION_KINDS = [
  "architecture",
  "critical_paths",
  "local_setup",
  "reading_order",
  "first_tasks",
] as const;
export type OnboardingSectionKind = (typeof ONBOARDING_SECTION_KINDS)[number];

export const SECTION_KIND_ICON: Record<OnboardingSectionKind, IconName> = {
  architecture: "Layers",
  critical_paths: "GitBranch",
  local_setup: "Wrench",
  reading_order: "ListChecks",
  first_tasks: "FlaskConical",
};

/** Complexity badge color — same severity-badge spirit as
 *  `vendor/ui/primitives/tokens.ts`'s `SEV` (icon + color, never color alone). */
export const COMPLEXITY_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "var(--ok)",
  medium: "var(--warn)",
  high: "var(--crit)",
};

export const DEGRADED_REASONS: OnboardingDegradedReason[] = [
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
  "llm_call_failed",
];
