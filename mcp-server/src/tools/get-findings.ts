import { z } from 'zod';
import { Severity, FindingCategory, FindingKind, Verdict } from '@devdigest/shared';
import type { ReviewRecord } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_findings` — read-only. Calls `GET /pulls/:id/reviews`, keyed by
 * `pr_id` (the same id used for `run_agent_on_pr`) — a PR can have been
 * reviewed by several agents, so the response is one entry per run/review,
 * not a single flattened list. 404/422 (bad or non-UUID pr_id) both map to
 * the same "not found" message rather than a raw status leak.
 *
 * Each run's shaped output strips persisted-only/internal fields (`id`,
 * `review_id`, `accepted_at`, `dismissed_at`) and truncates its `findings`
 * array to `limit` (default 50, max 200 — applied per run, not across runs),
 * reporting `total`/`truncated` so a caller knows more exist for that run.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const getFindingsInputSchema = {
  pr_id: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
};

export interface GetFindingsInput {
  pr_id: string;
  limit?: number;
}

const FindingOutput = z.object({
  severity: Severity,
  category: FindingCategory,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  // Only present when not the default 'finding' kind, e.g. 'secret_leak' /
  // 'lethal_trifecta' / 'phantom' / 'hook' — flagged so a caller can tell a
  // variant finding apart from a plain one without leaking every kind.
  kind: FindingKind.exclude(['finding']).nullish(),
});
export type FindingOutput = z.infer<typeof FindingOutput>;

const RunFindingsOutput = z.object({
  run_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  verdict: Verdict.nullable(),
  score: z.number().int().nullable(),
  findings: z.array(FindingOutput),
  total: z.number().int(),
  truncated: z.boolean(),
});

export const getFindingsOutputSchema = {
  runs: z.array(RunFindingsOutput),
  total_runs: z.number().int(),
};

export interface ShapedFindings {
  run_id: ReviewRecord['run_id'];
  agent_name: ReviewRecord['agent_name'];
  verdict: ReviewRecord['verdict'];
  score: ReviewRecord['score'];
  findings: FindingOutput[];
  total: number;
  truncated: boolean;
  // See errors.ts's ToolErrorResult for why: the MCP SDK's CallToolResult is
  // a "loose" zod object, so its inferred `structuredContent` target type
  // carries an index signature that a named interface must declare too.
  [key: string]: unknown;
}

/** Shared by `get_findings` and `run_agent_on_pr` (the latter reuses this
 * exact shaping for the single run it just started, instead of duplicating
 * it). */
export function shapeFindings(review: ReviewRecord, limit?: number): ShapedFindings {
  const cap = limit ?? DEFAULT_LIMIT;
  const total = review.findings.length;
  const truncated = total > cap;
  const findings: FindingOutput[] = review.findings.slice(0, cap).map((f) => ({
    severity: f.severity,
    category: f.category,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
    ...(f.kind && f.kind !== 'finding' ? { kind: f.kind } : {}),
  }));
  return {
    run_id: review.run_id,
    agent_name: review.agent_name ?? null,
    verdict: review.verdict,
    score: review.score,
    findings,
    total,
    truncated,
  };
}

export function notFoundMessage(prId: string): string {
  return `PR '${prId}' not found — copy pr_id from the DevDigest studio URL (check for stray whitespace), or verify it was imported.`;
}

export function createGetFindingsTool(http: HttpClient = httpClient) {
  return {
    name: 'get_findings',
    config: {
      title: 'Get Findings',
      description:
        "Fetch findings for a pull request, by pr_id (the same id used for run_agent_on_pr, copied from the DevDigest studio URL). Returns one entry per review run — a PR reviewed by several agents gets several entries, each with run_id, agent_name, verdict, score, and a findings array (severity, category, file, line range, title, rationale) capped at limit (default 50, max 200 per run). An empty runs array means no agent has reviewed this PR yet — call run_agent_on_pr first.",
      inputSchema: getFindingsInputSchema,
      outputSchema: getFindingsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ pr_id, limit }: GetFindingsInput) => {
      try {
        const reviews = await http.get<ReviewRecord[]>(`/pulls/${pr_id}/reviews`);
        const runs = reviews.map((review) => shapeFindings(review, limit));
        const output = { runs, total_runs: runs.length };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        // 404 = pr_id doesn't exist. 422 = the server's route param schema
        // rejected pr_id outright because it isn't UUID-shaped (`IdParams`,
        // server/_shared/schemas.ts) — from the caller's point of view
        // that's just as much "nothing here" as a 404, so both map to the
        // same forward-leading message instead of leaking a raw status.
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          return toToolErrorResult(new Error(notFoundMessage(pr_id)));
        }
        return toToolErrorResult(err);
      }
    },
  };
}
