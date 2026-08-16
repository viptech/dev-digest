/**
 * brief module constants (SPEC-04).
 */

/** Hard overall input budget (AC-2) — ceil(chars/4), same fallback heuristic
 *  every non-repo-intel prompt path in this codebase uses. Covers
 *  userMessage.length PLUS the rendered system prompt (risk-brief.system.md +
 *  INJECTION_GUARD) — AC-2's own text says "включно з системним промптом"
 *  (see the Development Plan's Constraints). */
export const MAX_BRIEF_INPUT_TOKENS = 8000;

/** Per-section char caps — sized so the SUM of every section at its own cap,
 *  PLUS the ~fixed system-prompt+guard overhead, stays comfortably under
 *  MAX_BRIEF_INPUT_TOKENS*4 chars even when every section is simultaneously
 *  maxed — no section needs a defensive suffix-truncation pass in the common
 *  case; MAX_BRIEF_INPUT_TOKENS is the safety net, not the primary control. */
export const MAX_BRIEF_DESCRIPTION_CHARS = 4000; // mirrors intent-service's own PR-body handling order of magnitude
export const MAX_BRIEF_ISSUE_BODY_CHARS = 3000; // mirrors intent-service's MAX_PLAN_SPEC_CHARS
export const MAX_BRIEF_SPECS_CHARS = 8000; // shared pool across ALL attached specs combined, mirrors onboarding's MAX_CONTEXT_DOC_CHARS order of magnitude

/** Intent is LLM-derived prose (`intent`/`in_scope[]`/`out_of_scope[]`), not
 *  bounded anywhere upstream — cap it explicitly here rather than assume it's
 *  "small" (cross-model review finding m8). */
export const MAX_BRIEF_INTENT_CHARS = 2000;

/** Very large PRs (edge case): list at most this many changed files by
 *  path/additions/deletions in the diff-stats input; PRs with more files
 *  still report the correct AGGREGATE additions/deletions/filesCount, just
 *  not a per-file line for every single file. Same order of magnitude as
 *  intent-service's MAX_HUNK_HEADER_FILES = 50. */
export const MAX_DIFF_STAT_FILES = 40;
