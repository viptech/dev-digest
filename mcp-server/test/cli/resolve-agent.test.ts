import { describe, it, expect } from 'vitest';
import { resolveAgent } from '../../src/cli/resolve-agent.js';
import { fakeHttp } from '../support/fake-http.js';
import { agentFixture } from '../support/fixtures.js';

describe('resolveAgent (CLI)', () => {
  it('matches by name, case-insensitively', async () => {
    const http = fakeHttp({ get: () => [agentFixture({ name: 'Security Reviewer' })] });
    const result = await resolveAgent('security reviewer', http);
    expect(result.id).toBe('agent-1');
  });

  it('throws, listing configured agent names, when nothing matches — no fuzzy suggestion (CLI convenience only, not a review-domain feature)', async () => {
    const http = fakeHttp({
      get: () => [agentFixture({ name: 'Security Reviewer' }), agentFixture({ id: 'agent-2', name: 'Performance Reviewer' })],
    });
    await expect(resolveAgent('nope', http)).rejects.toThrow(
      /Agent 'nope' not found\. Configured agents: Security Reviewer, Performance Reviewer/,
    );
  });

  it('lists "(none)" when there are no configured agents at all', async () => {
    const http = fakeHttp({ get: () => [] });
    await expect(resolveAgent('anything', http)).rejects.toThrow(/\(none\)/);
  });
});
