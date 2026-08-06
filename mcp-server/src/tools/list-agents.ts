import { z } from 'zod';
import { Provider, ReviewStrategy } from '@devdigest/shared';
import type { Agent } from '@devdigest/shared';
import { httpClient } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `list_agents` — read-only, no arguments. Drops `system_prompt`,
 * `output_schema`, `version`, `ci_fail_on`, `repo_intel` (internal/verbose,
 * not needed for tool selection) per the tool design's design principle #3.
 */

export const listAgentsInputSchema = {};

const AgentSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  enabled: z.boolean(),
  strategy: ReviewStrategy,
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const listAgentsOutputSchema = {
  agents: z.array(AgentSummary),
};

function toAgentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    enabled: agent.enabled,
    strategy: agent.strategy,
  };
}

export function createListAgentsTool(http: HttpClient = httpClient) {
  return {
    name: 'list_agents',
    config: {
      title: 'List Agents',
      description:
        "List all configured review agents in this workspace (id, name, provider, model, and whether each is enabled). Read-only, no arguments. Call this first to discover valid agent names before calling run_agent_on_pull_request — its agent argument must match one of the names returned here.",
      inputSchema: listAgentsInputSchema,
      outputSchema: listAgentsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async () => {
      try {
        const agents = await http.get<Agent[]>('/agents');
        const output = { agents: agents.map(toAgentSummary) };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  };
}
