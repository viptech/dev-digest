/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Project Context (SPEC-01) — size/DoS caps for attached-doc injection, NFR
 * "MEDIUM — unbounded size". Named constants so retuning later is a one-line
 * change, mirroring `MAX_PR_DESCRIPTION_CHARS = 4000`
 * (`reviewer-core/src/prompt.ts`). Exact numbers are this implementation's
 * call (the spec explicitly delegates them, OQ9) — not re-derived from any
 * other source.
 */
/** Per-document cap — content beyond this is truncated with a note. */
export const MAX_CONTEXT_DOC_CHARS = 8000;
/** Aggregate cap across all attached docs in one run — ~6000 tokens at the
 *  `ceil(chars/4)` heuristic, comfortably above `DEFAULT_REPO_MAP_TOKEN_BUDGET`
 *  (1500 tokens) since curated docs are higher-signal-density than a repo
 *  skeleton, but still bounded. */
export const MAX_CONTEXT_DOCS_TOTAL_CHARS = 24000;
