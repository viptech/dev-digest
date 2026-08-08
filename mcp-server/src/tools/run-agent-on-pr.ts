import { z } from 'zod';
import { Verdict, Severity, FindingCategory, FindingKind } from '@devdigest/shared';
import type { ReviewRunResponse, ReviewRecord } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { pollRunUntilTerminal, type PollClock } from '../polling.js';
import { toToolErrorResult, ToolError } from '../errors.js';
import { shapeFindings } from './get-findings.js';

/**
 * `run_agent_on_pr` — starts a new review run and waits for it. Takes
 * `agent_id`/`pr_id` directly (as returned by `list_agents` / copied from the
 * DevDigest studio URL) — no name/number resolution step, since both are
 * already the internal ids the API's routes need.
 *
 * Composes POST /pulls/:id/review + polling.ts (`GET /pulls/:id/runs` until
 * terminal) + get-findings.ts's shaping (once the run is 'done').
 *
 * Per root INSIGHTS.md's noted risk (an invalid review request can fail
 * *silently* — no run row ever produced, so polling would just time out with
 * no explanation): the POST itself already 404s on a bad `pr_id`/`agent_id`
 * (mapped to a specific error below), and an empty `runs[]` on an otherwise-
 * 2xx response also throws before polling ever starts.
 */

const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const trimmedId = z.string().trim().min(1);

export const runAgentOnPrInputSchema = {
  agent_id: trimmedId,
  pr_id: trimmedId,
};

export interface RunAgentOnPrInput {
  agent_id: string;
  pr_id: string;
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
  kind: FindingKind.exclude(['finding']).nullish(),
});

/** Output is a discriminated shape at runtime: either the completed result
 * ({run_id, verdict, score, findings, ...}) or the still-running budget-
 * exhausted result ({run_id, status: 'running', hint}) — modeled here as a
 * loose object schema since the MCP SDK's outputSchema is a single Zod raw
 * shape, not a union; unused fields are simply absent on either branch. */
export const runAgentOnPrOutputSchema = {
  run_id: z.string().optional(),
  agent_name: z.string().nullable().optional(),
  status: z.enum(['done', 'running']).optional(),
  verdict: Verdict.nullable().optional(),
  score: z.number().int().nullable().optional(),
  findings: z.array(FindingOutput).optional(),
  total: z.number().int().optional(),
  truncated: z.boolean().optional(),
  hint: z.string().optional(),
};

export interface RunAgentOnPrDeps {
  http?: HttpClient;
  clock?: PollClock;
}

/** Pulls the server's `{error:{message}}` body text out of an `ApiError`, if
 * shaped that way (see server's global error handler, app.ts) — used to tell
 * "agent not found" apart from "PR not found" on the same 404/422 status. */
function apiErrorMessage(err: ApiError): string {
  const body = err.body as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? '';
}

export function createRunAgentOnPrTool(deps: RunAgentOnPrDeps = {}) {
  const http = deps.http ?? httpClient;

  return {
    name: 'run_agent_on_pr',
    config: {
      title: 'Run Agent On PR',
      description:
        "Run a review agent on a pull request and wait for the result. Arguments: agent_id (from list_agents), pr_id (copy from the DevDigest studio URL — no owner/name or PR number needed). Starts a new review run, polls for up to ~60 seconds, and returns the final { verdict, score, findings } once the run completes. If the run is still in progress after ~60s, returns { run_id, status: 'running' } instead — call get_findings(pr_id) again after a short wait to retrieve the result.",
      inputSchema: runAgentOnPrInputSchema,
      outputSchema: runAgentOnPrOutputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    handler: async ({ agent_id, pr_id }: RunAgentOnPrInput) => {
      try {
        let runResponse: ReviewRunResponse;
        try {
          runResponse = await http.post<ReviewRunResponse>(`/pulls/${pr_id}/review`, {
            agentId: agent_id,
          });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
            const message = apiErrorMessage(err);
            if (/agent/i.test(message)) {
              throw new ToolError(`Agent '${agent_id}' not found — call list_agents to get a valid agent_id.`);
            }
            throw new ToolError(
              `PR '${pr_id}' not found — copy pr_id from the DevDigest studio URL (check for stray whitespace).`,
            );
          }
          throw err;
        }

        const target = runResponse.runs[0];
        if (!target) {
          // Mirrors the noted silent-failure risk: a 2xx response with no run
          // row means resolution upstream produced nothing to poll — fail
          // fast rather than let polling time out with no explanation.
          throw new ToolError(
            `POST /pulls/${pr_id}/review returned no run for agent_id '${agent_id}' — the review may not have started; check the agent is enabled and try again.`,
          );
        }
        const runId = target.run_id;

        const outcome = await pollRunUntilTerminal(
          http,
          pr_id,
          runId,
          { timeoutMs: POLL_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
          deps.clock,
        );

        if (outcome.status === 'running') {
          // Not an error — budget exhausted while still in progress.
          const output = {
            run_id: runId,
            status: 'running' as const,
            hint: 'call get_findings(pr_id) again shortly',
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
            structuredContent: output,
          };
        }

        if (outcome.status === 'failed' || outcome.status === 'cancelled') {
          // Terminal failure — get_findings won't help, say so.
          const reason = outcome.run.error ?? `run ended with status '${outcome.status}'`;
          return toToolErrorResult(
            new ToolError(
              `Run ${runId} ${outcome.status} — ${reason}. There is nothing to fetch via get_findings for this run; re-run run_agent_on_pr to try again.`,
            ),
          );
        }

        // Terminal 'done' — fetch and shape findings for this one run.
        const review = await http.get<ReviewRecord>(`/runs/${runId}/findings`);
        const output = shapeFindings(review);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  };
}
