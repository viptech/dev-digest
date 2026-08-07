import type { SmartDiffRole } from "@devdigest/shared";

/** Display order for Smart Diff's role groups — core/wiring first (expanded
   by default), boilerplate last (collapsed by default). */
export const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Group header copy, matching the homework mock's copy style. */
export const ROLE_LABEL: Record<SmartDiffRole, string> = {
  core: "Core logic",
  wiring: "Wiring",
  boilerplate: "Boilerplate",
};

export const ROLE_DESCRIPTION: Record<SmartDiffRole, string> = {
  core: "The substance of the change — review closely",
  wiring: "Hooks the core into the app",
  boilerplate: "Generated / mechanical — skim",
};

/** `core`/`wiring` start expanded, `boilerplate` starts collapsed — a literal
   acceptance criterion, not a styling preference. */
export const ROLE_DEFAULT_EXPANDED: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};

export const ROLE_ICON: Record<SmartDiffRole, "Code" | "Settings" | "Boxes"> = {
  core: "Code",
  wiring: "Settings",
  boilerplate: "Boxes",
};
