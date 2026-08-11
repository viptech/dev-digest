/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Prompt-assembly block accent colours (by leg). */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  // Was `var(--text-secondary)` — a pre-SPEC-01 placeholder that read as
  // visually muted/inactive, same weight as `system`'s always-static grey,
  // even though this row (like `skills`/`repoMap`) only ever renders when
  // it actually has content this run (`prompt_assembly.specs != null` in
  // TraceBody.tsx) — never an empty/inactive section. Matched to
  // `skills`/`repoMap`'s accent color so it visually reads as populated
  // dynamic content, not a static baseline section.
  specs: "var(--accent)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;
