import { describe, it, expect } from 'vitest';
import { createGetFindingsTool } from '../../src/tools/get-findings.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp } from '../support/fake-http.js';
import { findingRecordFixture, reviewRecordFixture } from '../support/fixtures.js';

describe('get_findings tool', () => {
  it('happy path: shapes verdict/score/findings, dropping persisted-only fields', async () => {
    const http = fakeHttp({ get: () => reviewRecordFixture() });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ run_id: 'run-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as {
      verdict: string | null;
      score: number | null;
      findings: Record<string, unknown>[];
      total: number;
      truncated: boolean;
    };
    expect(output.verdict).toBe('request_changes');
    expect(output.score).toBe(40);
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).not.toHaveProperty('id');
    expect(output.findings[0]).not.toHaveProperty('review_id');
    expect(output.findings[0]).not.toHaveProperty('accepted_at');
    expect(output.findings[0]).not.toHaveProperty('dismissed_at');
  });

  it('404 path: maps to isError with the "may still be running" message', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 404, body: { error: 'not found' } });
      },
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ run_id: 'run-x' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/may still be running/);
    expect(result.content[0]!.text).toMatch(/run_id doesn't exist/);
  });

  it('422 path (malformed/non-UUID run_id, rejected by the server\'s route schema): maps to the same "may still be running" message, not a raw status leak', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 422, body: { error: 'invalid uuid' } });
      },
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ run_id: 'not-a-real-run-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/may still be running/);
    expect(result.content[0]!.text).not.toMatch(/status 422/);
  });

  it('truncates findings at `limit` and reports total/truncated', async () => {
    const http = fakeHttp({
      get: () =>
        reviewRecordFixture({
          findings: [
            findingRecordFixture({ id: 'a' }),
            findingRecordFixture({ id: 'b' }),
            findingRecordFixture({ id: 'c' }),
          ],
        }),
    });
    const tool = createGetFindingsTool(http);
    const result = await tool.handler({ run_id: 'run-1', limit: 2 });

    const output = result.structuredContent as { findings: unknown[]; total: number; truncated: boolean };
    expect(output.findings).toHaveLength(2);
    expect(output.total).toBe(3);
    expect(output.truncated).toBe(true);
  });
});
