import type { Agent } from '@devdigest/shared';
import { httpClient } from '../http-client.js';
import type { HttpClient } from '../http-client.js';

/** Case-insensitive exact match on agent name, via `GET /agents` (the raw
 *  Agent shape, unlike `list_agents`'s MCP-tool shaping, includes
 *  `system_prompt`/`model`/`provider` — everything the review engine needs). */
export async function resolveAgent(name: string, http: HttpClient = httpClient): Promise<Agent> {
  const agents = await http.get<Agent[]>('/agents');
  const needle = name.toLowerCase();
  const match = agents.find((a) => a.name.toLowerCase() === needle);
  if (match) return match;
  const names = agents.map((a) => a.name).join(', ');
  throw new Error(`Agent '${name}' not found. Configured agents: ${names || '(none)'}`);
}
