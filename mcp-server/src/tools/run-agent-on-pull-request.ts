import { z } from 'zod';
import { Verdict, Severity, FindingCategory, FindingKind } from '@devdigest/shared';
import type { ReviewRunResponse, ReviewRecord } from '@devdigest/shared';
import { httpClient } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { resolveRepo, resolvePull, resolveAgent } from '../resolvers.js';
import { pollRunUntilTerminal, type PollClock } from '../polling.js';
import { toToolErrorResult, ToolError } from '../errors.js';
import { shapeFindings } from './get-findings.js';

/**
 * `run_agent_on_pull_request` — starts a new review run and waits for it.
 * Composes resolvers.ts (repo/pr/agent → UUIDs) + POST /pulls/:id/review +
 * polling.ts (`GET /pulls/:id/runs` until terminal) + get-findings.ts's
 * shaping (once the run is 'done'). See the plan's tool design #2 for the
 * full step-by-step and the exact poll budget (~60s / ~2s interval).
 *
 * Per root INSIGHTS.md's noted risk (an invalid review request can fail
 * *silently* — no run row ever produced, so polling would just time out with
 * no explanation): every resolution step below throws before
 * `POST /pulls/:id/review` is ever called, so a bad repo/PR/agent always
 * surfaces as a specific `isError: true`, never a generic timeout.
 */

const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

export const runAgentOnPullRequestInputSchema = {
  repo: z.string().min(1),
  pr: z.number().int(),
  agent: z.string().min(1),
};

export interface RunAgentOnPullRequestInput {
  repo: string;
  pr: number;
  agent: string;
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
 * ({verdict, score, findings, ...}) or the still-running budget-exhausted
 * result ({run_id, status: 'running', hint}) — modeled here as a loose
 * object schema since the MCP SDK's outputSchema is a single Zod raw shape,
 * not a union; unused fields are simply absent on either branch. */
export const runAgentOnPullRequestOutputSchema = {
  run_id: z.string().optional(),
  status: z.enum(['done', 'running']).optional(),
  verdict: Verdict.nullable().optional(),
  score: z.number().int().nullable().optional(),
  findings: z.array(FindingOutput).optional(),
  total: z.number().int().optional(),
  truncated: z.boolean().optional(),
  hint: z.string().optional(),
};

export interface RunAgentOnPullRequestDeps {
  http?: HttpClient;
  clock?: PollClock;
}

export function createRunAgentOnPullRequestTool(deps: RunAgentOnPullRequestDeps = {}) {
  const http = deps.http ?? httpClient;

  return {
    name: 'run_agent_on_pull_request',
    config: {
      title: 'Run Agent On Pull Request',
      description:
        "Run a named review agent on a pull request and wait for the result. Arguments: repo ('owner/name'), pr (PR number), agent (agent name, see list_agents). This starts a new review run, polls for up to ~60 seconds, and returns the final { verdict, score, findings } once the run completes. If the run is still in progress after ~60s, returns { run_id, status: 'running' } instead — call get_findings(run_id) again after a short wait to retrieve the result.",
      inputSchema: runAgentOnPullRequestInputSchema,
      outputSchema: runAgentOnPullRequestOutputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    handler: async ({ repo, pr, agent }: RunAgentOnPullRequestInput) => {
      try {
        // 1-3: resolve repo/pr/agent — fail fast, before starting any run.
        const repoRow = await resolveRepo(http, repo);
        const pull = await resolvePull(http, repoRow.id, pr, repo);
        const agentRow = await resolveAgent(http, agent);

        // 4: start the run.
        const runResponse = await http.post<ReviewRunResponse>(`/pulls/${pull.id}/review`, {
          agentId: agentRow.id,
        });
        const target = runResponse.runs[0];
        if (!target) {
          // Mirrors the noted silent-failure risk: a 2xx response with no run
          // row means resolution upstream produced nothing to poll — fail
          // fast rather than let polling time out with no explanation.
          throw new ToolError(
            `POST /pulls/${pull.id}/review returned no run for agent '${agent}' — the review may not have started; check the agent is enabled and try again.`,
          );
        }
        const runId = target.run_id;

        // 5: poll until terminal or budget exhausted.
        const outcome = await pollRunUntilTerminal(
          http,
          pull.id,
          runId,
          { timeoutMs: POLL_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
          deps.clock,
        );

        if (outcome.status === 'running') {
          // 8: not an error — budget exhausted while still in progress.
          const output = {
            run_id: runId,
            status: 'running' as const,
            hint: 'call get_findings(run_id) again shortly',
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
            structuredContent: output,
          };
        }

        if (outcome.status === 'failed' || outcome.status === 'cancelled') {
          // 7: terminal failure — get_findings won't help, say so.
          const reason = outcome.run.error ?? `run ended with status '${outcome.status}'`;
          return toToolErrorResult(
            new ToolError(
              `Run ${runId} ${outcome.status} — ${reason}. There is nothing to fetch via get_findings for this run; re-run run_agent_on_pull_request to try again.`,
            ),
          );
        }

        // 6: terminal 'done' — fetch and shape findings.
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
