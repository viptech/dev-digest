import { describe, it, expect } from 'vitest';
import { createGetBlastRadiusTool } from '../../src/tools/get-blast-radius.js';
import { fakeHttp } from '../support/fake-http.js';
import { prFixture, repoFixture } from '../support/fixtures.js';

describe('get_blast_radius tool', () => {
  it('happy path (repo/pr resolve): still always returns the documented stub error', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/pulls') return [prFixture()];
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ repo: 'acme/payments-api', pr: 482 });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not implemented yet/);
    expect(http.get).toHaveBeenCalledTimes(2); // /repos + /repos/:id/pulls — no other HTTP call.
  });

  it('not-found path: a bad repo surfaces the specific resolution error, not the generic stub', async () => {
    const http = fakeHttp({ get: () => [] });
    const tool = createGetBlastRadiusTool(http);
    const result = await tool.handler({ repo: 'nope/nope', pr: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found among connected repos/);
    expect(result.content[0]!.text).not.toMatch(/not implemented yet/);
  });
});
