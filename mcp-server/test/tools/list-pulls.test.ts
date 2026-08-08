import { describe, it, expect } from 'vitest';
import { createListPullsTool } from '../../src/tools/list-pulls.js';
import { ApiError } from '../../src/http-client.js';
import { fakeHttp } from '../support/fake-http.js';
import { prFixture } from '../support/fixtures.js';

describe('list_pulls tool', () => {
  it('happy path: lists PRs for a repo, shaped to pr_id + summary fields', async () => {
    const http = fakeHttp({ get: () => [prFixture()] });
    const tool = createListPullsTool(http);
    const result = await tool.handler({ repo_id: 'repo-1' });

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as {
      pulls: { pr_id: string; number: number; status: string }[];
      total: number;
    };
    expect(output.total).toBe(1);
    expect(output.pulls[0]!.pr_id).toBe('pr-1');
    expect(output.pulls[0]!.number).toBe(482);
    expect(output.pulls[0]).not.toHaveProperty('id');
    expect(output.pulls[0]).not.toHaveProperty('head_sha');
  });

  it('open_only:true drops merged/closed PRs', async () => {
    const http = fakeHttp({
      get: () => [
        prFixture({ id: 'pr-1', number: 1, status: 'merged' }),
        prFixture({ id: 'pr-2', number: 2, status: 'needs_review' }),
        prFixture({ id: 'pr-3', number: 3, status: 'closed' }),
        prFixture({ id: 'pr-4', number: 4, status: 'stale' }),
      ],
    });
    const tool = createListPullsTool(http);
    const result = await tool.handler({ repo_id: 'repo-1', open_only: true });

    const output = result.structuredContent as { pulls: { pr_id: string }[]; total: number };
    expect(output.total).toBe(2);
    expect(output.pulls.map((p) => p.pr_id)).toEqual(['pr-2', 'pr-4']);
  });

  it('not-found path: an unknown repo_id maps to isError with a forward-leading message', async () => {
    const http = fakeHttp({
      get: () => {
        throw new ApiError({ status: 404, body: { error: { message: 'Repo not found' } } });
      },
    });
    const tool = createListPullsTool(http);
    const result = await tool.handler({ repo_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/studio URL/);
  });
});
