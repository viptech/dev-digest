import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - SkillStats           per-skill quality aggregates (GET /skills/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStatsSkillUsage = z.object({
  skill_id: z.string(),
  name: z.string(),
  /** Fraction (0..1) of this window's runs that had this skill enabled+linked. */
  pct: z.number().min(0).max(1),
});
export type AgentStatsSkillUsage = z.infer<typeof AgentStatsSkillUsage>;

export const AgentStatsCategoryCount = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type AgentStatsCategoryCount = z.infer<typeof AgentStatsCategoryCount>;

export const AgentStatsRunRow = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  pr_number: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  source: z.enum(['local', 'ci']),
});
export type AgentStatsRunRow = z.infer<typeof AgentStatsRunRow>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
  most_used_skills: z.array(AgentStatsSkillUsage),
  findings_by_category: z.array(AgentStatsCategoryCount),
  run_history: z.array(AgentStatsRunRow),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Per-skill Stats (GET /skills/:id/stats)
// ---------------------------------------------------------------------------

export const SkillStatsAgentUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Fraction (0..1) of THIS agent's 'done' runs (30d window) that actually
   *  pulled this skill (skill_ids contains it) — null when the agent has no
   *  'done' runs in the window. */
  pull_rate: z.number().min(0).max(1).nullable(),
});
export type SkillStatsAgentUsage = z.infer<typeof SkillStatsAgentUsage>;

export const SkillStatsCategoryCost = z.object({
  category: z.string(),
  /** Dollar cost attributed to this category — evenly split per finding
   *  within its own run (AC-26), summed across the 30d window. Never a raw
   *  finding count. */
  cost_usd: z.number(),
});
export type SkillStatsCategoryCost = z.infer<typeof SkillStatsCategoryCost>;

export const SkillStats = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  /** Distinct agents CURRENTLY linking this skill via agent_skills — direct
   *  attachment, not transitive (AC-23). */
  used_by_agents: z.number().int(),
  /** null when the denominator is 0 (unlinked, or linked agents with no
   *  'done' run in the window) — never rendered as 0% (AC-24). */
  pull_rate: z.number().min(0).max(1).nullable(),
  /** null when no finding in the window has a decision yet — vacuous null,
   *  not 0 (AC-25). */
  accept_rate: z.number().min(0).max(1).nullable(),
  agents: z.array(SkillStatsAgentUsage),
  cost_by_category: z.array(SkillStatsCategoryCost),
});
export type SkillStats = z.infer<typeof SkillStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
