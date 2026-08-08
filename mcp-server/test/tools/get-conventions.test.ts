import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createGetConventionsTool, getConventionsInputSchema } from '../../src/tools/get-conventions.js';
import { fakeHttp } from '../support/fake-http.js';
import { conventionFixture, repoFixture } from '../support/fixtures.js';

describe('get_conventions tool', () => {
  it('happy path: repo_id found among connected repos, returns its conventions', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture({ id: 'repo-1' })];
        if (path === '/repos/repo-1/conventions') return [conventionFixture()];
        throw new Error(`unexpected path ${path}`);
      },
    });
    const tool = createGetConventionsTool(http);
    const result = await tool.handler({ repo_id: 'repo-1' });

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

  it('input schema trims stray leading/trailing whitespace off repo_id (SDK parses input through this before calling the handler)', () => {
    const parsed = z.object(getConventionsInputSchema).parse({ repo_id: '  repo-1  ' });
    expect(parsed.repo_id).toBe('repo-1');
  });

  it('not-found path: an unknown repo_id maps to isError with a forward-leading message', async () => {
    const http = fakeHttp({ get: () => [repoFixture({ id: 'repo-1' })] });
    const tool = createGetConventionsTool(http);
    const result = await tool.handler({ repo_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found among connected repos/);
  });

  it('truncates the list at `limit` and reports total/truncated', async () => {
    const http = fakeHttp({
      get: (path) => {
        if (path === '/repos') return [repoFixture({ id: 'repo-1' })];
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
    const result = await tool.handler({ repo_id: 'repo-1', limit: 2 });

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
