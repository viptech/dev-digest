import { OpenRouterProvider } from '@devdigest/reviewer-core';
import type { LLMProvider, Provider } from '@devdigest/shared';
import { getSecret } from './secrets.js';

/**
 * v1 scope: only `provider: 'openrouter'` agents are supported. The server's
 * own `buildLlm()` (platform/container.ts) also supports 'openai'/'anthropic'
 * via adapters that live under `server/src/adapters/llm/*` — those pull in
 * their own SDK dependencies and deeper server-internal helpers
 * (`platform/resilience.ts`, `platform/structured.ts`). Reusing them would be
 * a bigger cross-package surface than this optional CLI needs; scoping to
 * openrouter keeps it to the one provider `@devdigest/reviewer-core` already
 * exports publicly (`OpenRouterProvider`, shared with the CI runner).
 *
 * No `estimateCost` callback is injected (unlike the server's own openrouter
 * path, which wires its DB-backed `PriceBook`) — cost falls back to
 * OpenRouter's own `costFromApi` when the API returns it, else `null`
 * ("cost unknown", never a fabricated number).
 */
export class UnsupportedProviderError extends Error {
  constructor(agentName: string, provider: string) {
    super(
      `Agent '${agentName}' uses provider '${provider}', which this CLI doesn't support yet — ` +
        `configure an agent backed by 'openrouter', or use --agent with an openrouter provider.`,
    );
    this.name = 'UnsupportedProviderError';
  }
}

export class MissingApiKeyError extends Error {
  constructor(key: string) {
    super(`${key} is not configured (checked ~/.devdigest/secrets.json and the environment).`);
    this.name = 'MissingApiKeyError';
  }
}

export async function resolveLlmProvider(agentName: string, provider: Provider): Promise<LLMProvider> {
  if (provider !== 'openrouter') {
    throw new UnsupportedProviderError(agentName, provider);
  }
  const key = await getSecret('OPENROUTER_API_KEY');
  if (!key) throw new MissingApiKeyError('OPENROUTER_API_KEY');
  return new OpenRouterProvider(key);
}
