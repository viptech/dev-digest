/**
 * Smart Diff classification constants — ALL patterns/thresholds for
 * `classifyFile` live here, never inline in the classifier body. Match order
 * matters: `classifyFile` checks boilerplate first (highest priority, must
 * never be shadowed by a wiring pattern), then wiring, else `core` (default).
 */

/** Lock files, build output, and generated snapshots — unconditionally
 *  `boilerplate` regardless of nesting depth (e.g.
 *  `packages/foo/package-lock.json` still matches). */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
];

/** Config/env/tsconfig and barrel/index files — the "wire the app together"
 *  glue, not business logic. */
export const WIRING_PATTERNS: RegExp[] = [
  /\.config\.[^/]+$/,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
];

/** `split_suggestion.too_big` threshold — total additions+deletions across
 *  every file in the PR. */
export const SPLIT_THRESHOLD_LINES = 400;
