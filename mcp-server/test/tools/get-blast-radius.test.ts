import { describe, it, expect } from 'vitest';
import { createGetBlastRadiusTool } from '../../src/tools/get-blast-radius.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp } from '../support/fake-http.js';
import { prFixture } from '../support/fixtures.js';

describe('get_blast_radius tool', () => {
  it('happy path (pr_id resolves): still always returns the documented stub error', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/pulls/pr-1') return prFixture();
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'pr-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not implemented yet/);
    expect(http.get).toHaveBeenCalledTimes(1); // only /pulls/:id — no other HTTP call.
  });

  it('not-found path: a bad pr_id surfaces the specific resolution error, not the generic stub', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 404, body: {} });
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ pr_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
    expect(result.content[0]!.text).not.toMatch(/not implemented yet/);
  });
});
