import { z } from 'zod';
import { Severity, Verdict, FindingsSummary } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- PR Brief review rollup (deterministic — see PrBriefSnapshot below) ----
/**
 * Verdict/score/blockers/summary from the PR's single most-recently-created
 * review (same "latest wins" precedent `PrMeta.score` already uses for the
 * PR list, `pulls/routes.ts`'s "newest-first, first-seen-wins") — not an
 * aggregate across every agent that has reviewed the PR. `verdict` is
 * recomputed from that review's own blockers/findings count, never read from
 * the `reviews.verdict` column (that column is the model's own self-report —
 * see `reviewer-core/review/reduce.ts` — and is not trusted for this).
 * `cost_usd`/`tokens_in`/`tokens_out` are the exception: summed across EVERY
 * run ever for the PR, mirroring `PrMeta.cost_usd`'s existing "every review
 * pass, not just latest" semantics — a deliberately different row-set than
 * verdict/score/findings/blockers.
 *
 * `findings_summary` is the SAME `buildFindingsSummary()` output the PR list
 * already computes for its FINDINGS column (`pulls/findings-summary.ts`),
 * built from this same latest review's findings — so the Brief card's
 * per-severity badges can never disagree with what the list shows for this
 * PR (no separate/redundant total count field).
 */
export const PrBriefReviewRollup = z.object({
  verdict: Verdict,
  score: z.number().int(),
  findings_summary: FindingsSummary,
  blockers_count: z.number().int(),
  summary: z.string().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
});
export type PrBriefReviewRollup = z.infer<typeof PrBriefReviewRollup>;

/**
 * `GET /pulls/:id/brief`. `review_rollup` is `null` when the PR has never
 * been reviewed (mirrors `PrIntentRecord | null`).
 */
export const PrBriefSnapshot = z.object({
  review_rollup: PrBriefReviewRollup.nullable(),
});
export type PrBriefSnapshot = z.infer<typeof PrBriefSnapshot>;

// ---- Intent ----
/** Explicit structural confidence — not a prose caveat folded into `intent`. */
export const IntentConfidence = z.enum(['high', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** Provenance: which signal category actually drove the classification.
 *  'inferred' is the synthesized-from-indirect-signals case. */
export const IntentSource = z.enum(['description', 'linked_issue', 'plan_spec', 'inferred']);
export type IntentSource = z.infer<typeof IntentSource>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence,
  source: IntentSource,
  /** The resolved plan/spec path or cited URL that informed the intent, if any. */
  plan_ref: z.string().nullish(),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
/** Why a `BlastRadius` result is degraded — mirrors repo-intel's own
 *  `DegradedReason` (server/src/modules/repo-intel/types.ts), re-declared
 *  here as the wire contract's own enum so this file stays the single
 *  source of truth for the HTTP boundary. */
export const BlastDegradedReason = z.enum([
  'flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One finding anchored to a line, for the inline per-line severity badge.
 *  `id` is the underlying finding row's id — lets the client jump from a
 *  Smart Diff badge straight to that finding's card in the Findings tab. */
export const SmartDiffFinding = z.object({
  id: z.string(),
  line: z.number().int(),
  severity: Severity,
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  findings: z.array(SmartDiffFinding),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
