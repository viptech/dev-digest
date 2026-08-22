import { describe, it, expect } from 'vitest';
import type { ReviewRunResponse } from '@devdigest/shared';
import { createRunAgentOnPrTool } from '../../src/tools/run-agent-on-pr.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp, instantClock } from '../support/fake-http.js';
import { reviewRecordFixture, runSummaryFixture } from '../support/fixtures.js';

const REVIEW_RUN_RESPONSE: ReviewRunResponse = {
  pr_id: 'pr-1',
  runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer' }],
  reviews: [],
  run_group_id: null,
};

describe('run_agent_on_pr tool', () => {
  it('happy path: starts a run by agent_id/pr_id, polls to done, returns shaped findings', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1/runs') return [runSummaryFixture({ status: 'done' })];
        if (path === '/runs/run-1/findings') return reviewRecordFixture();
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path, body) => {
        if (path === '/pulls/pr-1/review') {
          expect(body).toEqual({ agentId: 'agent-1' });
          return REVIEW_RUN_RESPONSE;
        }
        throw new Error(`unexpected POST ${path}`);
      },
    });
    const tool = createRunAgentOnPrTool({ http, clock: instantClock() });
    const result = await tool.handler({ agent_id: 'agent-1', pr_id: 'pr-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { verdict: string | null; score: number | null };
    expect(output.verdict).toBe('request_changes');
    expect(output.score).toBe(40);
  });

  it('not-found path: an unknown agent_id fails with a forward-leading message, before polling', async () => {
    const http = fakeHttp({
      post: () => {
        throw new ApiError({ status: 404, body: { error: { message: 'Agent not found' } } });
      },
    });
    const tool = createRunAgentOnPrTool({ http, clock: instantClock() });
    const result = await tool.handler({ agent_id: 'nope', pr_id: 'pr-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/call list_agents/);
  });

  it('not-found path: an unknown pr_id fails with a forward-leading message, before polling', async () => {
    const http = fakeHttp({
      post: () => {
        throw new ApiError({ status: 404, body: { error: { message: 'Pull request not found' } } });
      },
    });
    const tool = createRunAgentOnPrTool({ http, clock: instantClock() });
    const result = await tool.handler({ agent_id: 'agent-1', pr_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/studio URL/);
  });

  it('running/timeout branch: returns {status: "running", hint}, NOT an error', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1/runs') return [runSummaryFixture({ status: 'running' })];
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === '/pulls/pr-1/review') return REVIEW_RUN_RESPONSE;
        throw new Error(`unexpected POST ${path}`);
      },
    });
    const tool = createRunAgentOnPrTool({ http, clock: instantClock() });
    const result = await tool.handler({ agent_id: 'agent-1', pr_id: 'pr-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { run_id: string; status: string; hint: string };
    expect(output.status).toBe('running');
    expect(output.run_id).toBe('run-1');
    expect(output.hint).toMatch(/get_findings/);
  });

  it('failed/cancelled branch: returns isError with the run\'s error, no findings to fetch', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1/runs') {
          return [runSummaryFixture({ status: 'failed', error: 'LLM crashed mid-run' })];
        }
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === '/pulls/pr-1/review') return REVIEW_RUN_RESPONSE;
        throw new Error(`unexpected POST ${path}`);
      },
    });
    const tool = createRunAgentOnPrTool({ http, clock: instantClock() });
    const result = await tool.handler({ agent_id: 'agent-1', pr_id: 'pr-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/LLM crashed mid-run/);
  });
});
