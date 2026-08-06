import { describe, it, expect } from 'vitest';
import type { ReviewRunResponse } from '@devdigest/shared';
import { createRunAgentOnPullRequestTool } from '../../src/tools/run-agent-on-pull-request.js';
import { fakeHttp, instantClock } from '../support/fake-http.js';
import { agentFixture, prFixture, repoFixture, reviewRecordFixture, runSummaryFixture } from '../support/fixtures.js';

const REVIEW_RUN_RESPONSE: ReviewRunResponse = {
  pr_id: 'pr-1',
  runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer' }],
  reviews: [],
};

describe('run_agent_on_pull_request tool', () => {
  it('happy path: resolves, starts a run, polls to done, returns shaped findings', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/pulls') return [prFixture()];
        if (path === '/agents') return [agentFixture()];
        if (path === '/pulls/pr-1/runs') return [runSummaryFixture({ status: 'done' })];
        if (path === '/runs/run-1/findings') return reviewRecordFixture();
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === '/pulls/pr-1/review') return REVIEW_RUN_RESPONSE;
        throw new Error(`unexpected POST ${path}`);
      },
    });
    const tool = createRunAgentOnPullRequestTool({ http, clock: instantClock() });
    const result = await tool.handler({ repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { verdict: string | null; score: number | null };
    expect(output.verdict).toBe('request_changes');
    expect(output.score).toBe(40);
  });

  it('not-found path: an unresolvable agent fails fast, before POSTing a review', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/pulls') return [prFixture()];
        if (path === '/agents') return [];
        throw new Error(`unexpected GET ${path}`);
      },
    });
    const tool = createRunAgentOnPullRequestTool({ http, clock: instantClock() });
    const result = await tool.handler({ repo: 'acme/payments-api', pr: 482, agent: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/call list_agents/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('running/timeout branch: returns {status: "running", hint}, NOT an error', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/pulls') return [prFixture()];
        if (path === '/agents') return [agentFixture()];
        if (path === '/pulls/pr-1/runs') return [runSummaryFixture({ status: 'running' })];
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === '/pulls/pr-1/review') return REVIEW_RUN_RESPONSE;
        throw new Error(`unexpected POST ${path}`);
      },
    });
    const tool = createRunAgentOnPullRequestTool({ http, clock: instantClock() });
    const result = await tool.handler({ repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { run_id: string; status: string; hint: string };
    expect(output.status).toBe('running');
    expect(output.run_id).toBe('run-1');
    expect(output.hint).toMatch(/get_findings/);
  });

  it('failed/cancelled branch: returns isError with the run\'s error, no findings to fetch', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/pulls') return [prFixture()];
        if (path === '/agents') return [agentFixture()];
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
    const tool = createRunAgentOnPullRequestTool({ http, clock: instantClock() });
    const result = await tool.handler({ repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/LLM crashed mid-run/);
  });
});
