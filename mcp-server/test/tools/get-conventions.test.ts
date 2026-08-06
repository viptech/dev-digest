import { describe, it, expect } from 'vitest';
import { createGetConventionsTool } from '../../src/tools/get-conventions.js';
import { fakeHttp } from '../support/fake-http.js';
import { conventionFixture, repoFixture } from '../support/fixtures.js';

describe('get_conventions tool', () => {
  it('happy path: resolves the repo, then returns its conventions', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/conventions') return [conventionFixture()];
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetConventionsTool(http);
    const result = await tool.handler({ repo: 'acme/payments-api' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as {
      conventions: unknown[];
      total: number;
      truncated: boolean;
    };
    expect(output.conventions).toHaveLength(1);
    expect(output.total).toBe(1);
    expect(output.truncated).toBe(false);
  });

  it('not-found path: an unknown repo maps to isError with a forward-leading message', async () => {
    const http = fakeHttp({ get: () => [] });
    const tool = createGetConventionsTool(http);
    const result = await tool.handler({ repo: 'nope/nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found among connected repos/);
  });

  it('truncates the list at `limit` and reports total/truncated', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture()];
        if (path === '/repos/repo-1/conventions') {
          return [
            conventionFixture({ id: 'a' }),
            conventionFixture({ id: 'b' }),
            conventionFixture({ id: 'c' }),
          ];
        }
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetConventionsTool(http);
    const result = await tool.handler({ repo: 'acme/payments-api', limit: 2 });

    const output = result.structuredContent as {
      conventions: unknown[];
      total: number;
      truncated: boolean;
    };
    expect(output.conventions).toHaveLength(2);
    expect(output.total).toBe(3);
    expect(output.truncated).toBe(true);
  });
});
