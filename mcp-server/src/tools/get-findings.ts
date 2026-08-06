import { z } from 'zod';
import { Severity, FindingCategory, FindingKind, Verdict } from '@devdigest/shared';
import type { ReviewRecord } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_findings` — read-only. Calls the new `GET /runs/:id/findings` route
 * (Gap 2's resolution: additive, keyed directly by `run_id`, no repo/pr
 * needed up front). 404 is mapped to a specific "may still be running or
 * doesn't exist" message rather than a raw 404 body.
 *
 * Output strips persisted-only/internal fields (`id`, `review_id`,
 * `accepted_at`, `dismissed_at`) per the tool design's design principle #3,
 * and truncates the `findings` array to `limit` (default 50, max 200),
 * reporting `total`/`truncated` so a caller knows more exist.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const getFindingsInputSchema = {
  run_id: z.string().min(1),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
};

export interface GetFindingsInput {
  run_id: string;
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

export const getFindingsOutputSchema = {
  verdict: Verdict.nullable(),
  score: z.number().int().nullable(),
  findings: z.array(FindingOutput),
  total: z.number().int(),
  truncated: z.boolean(),
};

export interface ShapedFindings {
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

/** Shared by `get_findings` and `run_agent_on_pull_request` (step 6 of the
 * latter reuses this exact shaping instead of duplicating it). */
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
  return { verdict: review.verdict, score: review.score, findings, total, truncated };
}

export function notFoundMessage(runId: string): string {
  return `Run '${runId}' has no findings yet — it may still be running (call run_agent_on_pull_request and wait) or the run_id doesn't exist.`;
}

export function createGetFindingsTool(http: HttpClient = httpClient) {
  return {
    name: 'get_findings',
    config: {
      title: 'Get Findings',
      description:
        "Fetch findings for an already-completed agent run, by run_id (as returned by run_agent_on_pull_request). Returns verdict, score, and a findings array (severity, category, file, line range, title, rationale) — capped at limit (default 50, max 200), with total/truncated so you know if more exist. If the run has no findings yet, it may still be running — call run_agent_on_pull_request and wait, or re-check shortly.",
      inputSchema: getFindingsInputSchema,
      outputSchema: getFindingsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ run_id, limit }: GetFindingsInput) => {
      try {
        const review = await http.get<ReviewRecord>(`/runs/${run_id}/findings`);
        const output = shapeFindings(review, limit);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        // 404 = no review row for this run_id (genuinely unknown/not-done-yet
        // run). 422 = the server's route param schema rejected run_id outright
        // because it isn't UUID-shaped (`IdParams`, server/_shared/schemas.ts)
        // — from the caller's point of view that's just as much "nothing
        // here" as a 404, so both map to the same forward-leading message
        // instead of leaking a raw "status 422"/validation body.
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          return toToolErrorResult(new Error(notFoundMessage(run_id)));
        }
        return toToolErrorResult(err);
      }
    },
  };
}
