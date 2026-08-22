import type { IconName } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";

/** Target step's 4 cards (G3/AC-5) — GitHub Actions is the only one with a
 *  real generator; the other three render, visually disabled, so the user
 *  can see what's planned without being able to select it (Non-goals). */
export interface TargetCard {
  key: CiTarget;
  icon: IconName;
  labelKey: string;
  descKey: string;
  enabled: boolean;
}

export const TARGET_CARDS: readonly TargetCard[] = [
  { key: "gha", icon: "Workflow", labelKey: "exportWizard.targets.gha", descKey: "exportWizard.targets.ghaDesc", enabled: true },
  { key: "circle", icon: "Layers", labelKey: "exportWizard.targets.circle", descKey: "exportWizard.targets.circleDesc", enabled: false },
  { key: "jenkins", icon: "Wrench", labelKey: "exportWizard.targets.jenkins", descKey: "exportWizard.targets.jenkinsDesc", enabled: false },
  { key: "cli", icon: "Command", labelKey: "exportWizard.targets.cli", descKey: "exportWizard.targets.cliDesc", enabled: false },
];

/** Step order for `ExportWizardSteps` (`step`+`labels`) — resolved through
 *  `t(\`exportWizard.steps.${key}\`)` by the caller, not hardcoded strings. */
export const WIZARD_STEP_KEYS = ["target", "preview", "configure", "install"] as const;
export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number];

/** File path the Preview step shows as "(empty — no memory recorded yet)"
 *  instead of a text editor (AC-10) — despite the server marking it
 *  `editable: true` like the other hand-authored files. */
export const MEMORY_FILE_PATH = ".devdigest/memory.jsonl";
