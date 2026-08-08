import { describe, it, expect } from 'vitest';
import { createListAgentsTool } from '../../src/tools/list-agents.js';
import { fakeHttp } from '../support/fake-http.js';
import { agentFixture } from '../support/fixtures.js';

describe('list_agents tool', () => {
  it('happy path: returns a filtered subset of agents (drops internal fields)', async () => {
    const http = fakeHttp({ get: () => [agentFixture()] });
    const tool = createListAgentsTool(http);
    const result = await tool.handler();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      agents: [
        {
          id: 'agent-1',
          name: 'Security Reviewer',
          description: 'Flags security issues in diffs.',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          enabled: true,
          strategy: 'single-pass',
        },
      ],
    });
    expect((result.structuredContent as { agents: unknown[] }).agents[0]).not.toHaveProperty(
      'system_prompt',
    );
  });

  it('error path: an upstream failure maps to isError, not a thrown exception', async () => {
    const http = fakeHttp({
      get: () => {
        throw new Error('DevDigest API unreachable');
      },
    });
    const tool = createListAgentsTool(http);
    const result = await tool.handler();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/unreachable/);
  });
});
