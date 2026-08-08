import { describe, it, expect } from 'vitest';
import { createGetBlastRadiusTool } from '../../src/tools/get-blast-radius.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp } from '../support/fake-http.js';
import { prFixture, blastRadiusFixture } from '../support/fixtures.js';

describe('get_blast_radius tool', () => {
  it('happy path: calls GET /pulls/:id then GET /pulls/:id/blast, and round-trips the shaped output', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1') return prFixture();
        if (path === '/pulls/pr-1/blast') return blastRadiusFixture();
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    expect(result.isError).toBeUndefined();
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenNthCalledWith(1, '/pulls/pr-1');
    expect(http.get).toHaveBeenNthCalledWith(2, '/pulls/pr-1/blast');

    const output = result.structuredContent as ReturnType<typeof blastRadiusFixture>;
    expect(output.changed_symbols).toEqual([
      { file: 'src/payments/retry.ts', name: 'retryWithBackoff', kind: 'function' },
    ]);
    expect(output.downstream).toHaveLength(1);
    expect(output.downstream[0]!.symbol).toBe('retryWithBackoff');
    expect(output.downstream[0]!.callers).toEqual([
      { name: 'chargeCard', file: 'src/payments/service.ts', line: 42 },
    ]);
    expect(output.summary).toBe('1 symbol(s) changed, 1 caller(s), 1 endpoint(s) potentially affected');
  });

  it('round-trips degraded/reason when the index is incomplete', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1') return prFixture();
        if (path === '/pulls/pr-1/blast') {
          return blastRadiusFixture({ degraded: true, reason: 'index_partial' });
        }
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    const output = result.structuredContent as ReturnType<typeof blastRadiusFixture>;
    expect(output.degraded).toBe(true);
    expect(output.reason).toBe('index_partial');
  });

  it('not-found path (pr_id resolution fails): maps to a forward-leading "not found" message, no second HTTP call', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 404, body: {} });
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
    expect(result.content[0]!.text).toMatch(/studio URL/);
    expect(http.get).toHaveBeenCalledTimes(1); // only /pulls/:id — resolution failed before /blast.
  });

  it('422 path (malformed/non-UUID pr_id): maps to the same "not found" message, not a raw status leak', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 422, body: {} });
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'not-a-real-pr-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
    expect(result.content[0]!.text).not.toMatch(/status 422/);
  });

  it('an unexpected error (e.g. 500 from /blast after pr_id resolved) is forwarded, not swallowed', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1') return prFixture();
        throw new ApiError({ status: 500, body: { error: 'boom' } });
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toMatch(/not found/);
  });
});
