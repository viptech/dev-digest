import { describe, it, expect } from 'vitest';
import { resolveAgent, resolvePull, resolveRepo, ResolutionError } from '../src/resolvers.js';
import { fakeHttp } from './support/fake-http.js';
import { agentFixture, prFixture, repoFixture } from './support/fixtures.js';

describe('resolveRepo', () => {
  it('matches full_name case-insensitively', async () => {
    const http = fakeHttp({ get: () => [repoFixture({ full_name: 'Acme/Payments-API' })] });
    const result = await resolveRepo(http, 'acme/payments-api');
    expect(result.id).toBe('repo-1');
  });

  it('throws ResolutionError with a forward-leading message when nothing matches', async () => {
    const http = fakeHttp({ get: () => [repoFixture({ full_name: 'other/repo' })] });
    await expect(resolveRepo(http, 'acme/payments-api')).rejects.toThrow(ResolutionError);
    await expect(resolveRepo(http, 'acme/payments-api')).rejects.toThrow(
      /not found among connected repos/,
    );
  });
});

describe('resolvePull', () => {
  it('matches by PR number', async () => {
    const http = fakeHttp({ get: () => [prFixture({ number: 482 }), prFixture({ id: 'pr-2', number: 1 })] });
    const result = await resolvePull(http, 'repo-1', 482, 'acme/payments-api');
    expect(result.id).toBe('pr-1');
  });

  it('throws ResolutionError when the PR number is not found', async () => {
    const http = fakeHttp({ get: () => [prFixture({ number: 1 })] });
    await expect(resolvePull(http, 'repo-1', 999, 'acme/payments-api')).rejects.toThrow(
      ResolutionError,
    );
    await expect(resolvePull(http, 'repo-1', 999, 'acme/payments-api')).rejects.toThrow(
      /may not be imported yet/,
    );
  });
});

describe('resolveAgent', () => {
  it('matches name case-insensitively, exact match first', async () => {
    const http = fakeHttp({ get: () => [agentFixture({ name: 'Security Reviewer' })] });
    const result = await resolveAgent(http, 'security reviewer');
    expect(result.id).toBe('agent-1');
  });

  it('throws ResolutionError with a "did you mean" hint on a near miss', async () => {
    const http = fakeHttp({ get: () => [agentFixture({ name: 'Security Reviewer' })] });
    await expect(resolveAgent(http, 'security')).rejects.toThrow(/Did you mean: Security Reviewer/);
  });

  it('throws ResolutionError pointing at list_agents with no hint when nothing is close', async () => {
    const http = fakeHttp({ get: () => [agentFixture({ name: 'Security Reviewer' })] });
    await expect(resolveAgent(http, 'totally-unrelated')).rejects.toThrow(/call list_agents/);
  });
});
