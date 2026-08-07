import { describe, it, expect } from 'vitest';
import { createGetFindingsTool } from '../../src/tools/get-findings.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp } from '../support/fake-http.js';
import { findingRecordFixture, reviewRecordFixture } from '../support/fixtures.js';

describe('get_findings tool', () => {
  it('happy path: groups findings by run, dropping persisted-only fields', async () => {
    const http = fakeHttp({ get: () => [reviewRecordFixture()] });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as {
      runs: {
        run_id: string | null;
        agent_name: string | null;
        verdict: string | null;
        score: number | null;
        findings: Record<string, unknown>[];
        total: number;
        truncated: boolean;
      }[];
      total_runs: number;
    };
    expect(output.total_runs).toBe(1);
    const run = output.runs[0]!;
    expect(run.run_id).toBe('run-1');
    expect(run.agent_name).toBe('Security Reviewer');
    expect(run.verdict).toBe('request_changes');
    expect(run.score).toBe(40);
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]).not.toHaveProperty('id');
    expect(run.findings[0]).not.toHaveProperty('review_id');
    expect(run.findings[0]).not.toHaveProperty('accepted_at');
    expect(run.findings[0]).not.toHaveProperty('dismissed_at');
  });

  it('a PR reviewed by several agents returns one entry per run, not a flat list', async () => {
    const http = fakeHttp({
      get: () => [
        reviewRecordFixture({ id: 'review-1', run_id: 'run-1', agent_name: 'Security Reviewer' }),
        reviewRecordFixture({ id: 'review-2', run_id: 'run-2', agent_name: 'Performance Reviewer', score: 90 }),
      ],
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    const output = result.structuredContent as { runs: { run_id: string | null }[]; total_runs: number };
    expect(output.total_runs).toBe(2);
    expect(output.runs.map((r) => r.run_id)).toEqual(['run-1', 'run-2']);
  });

  it('a PR with no reviews yet returns an empty runs array, not an error', async () => {
    const http = fakeHttp({ get: () => [] });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { runs: unknown[]; total_runs: number };
    expect(output.runs).toHaveLength(0);
    expect(output.total_runs).toBe(0);
  });

  it('404 path: maps to isError with a forward-leading "not found" message', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 404, body: { error: { message: 'Pull request not found' } } });
      },
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'pr-x' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
    expect(result.content[0]!.text).toMatch(/studio URL/);
  });

  it('422 path (malformed/non-UUID pr_id, rejected by the server\'s route schema): maps to the same "not found" message, not a raw status leak', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 422, body: { error: 'invalid uuid' } });
      },
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'not-a-real-pr-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
    expect(result.content[0]!.text).not.toMatch(/status 422/);
  });

  it('truncates each run\'s findings at `limit` and reports total/truncated per run', async () => {
    const http = fakeHttp({
      get: () => [
        reviewRecordFixture({
          findings: [
            findingRecordFixture({ id: 'a' }),
            findingRecordFixture({ id: 'b' }),
            findingRecordFixture({ id: 'c' }),
          ],
        }),
      ],
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ pr_id: 'pr-1', limit: 2 });

    const output = result.structuredContent as {
      runs: { findings: unknown[]; total: number; truncated: boolean }[];
    };
    const run = output.runs[0]!;
    expect(run.findings).toHaveLength(2);
    expect(run.total).toBe(3);
    expect(run.truncated).toBe(true);
  });
});
