import { describe, it, expect, vi, afterEach } from 'vitest';

let mockKey: string | undefined;

vi.mock('../../src/cli/secrets.js', () => ({
  getSecret: async () => mockKey,
}));

import { resolveLlmProvider, UnsupportedProviderError, MissingApiKeyError } from '../../src/cli/llm-provider.js';

afterEach(() => {
  mockKey = undefined;
});

describe('resolveLlmProvider', () => {
  it('throws UnsupportedProviderError for a non-openrouter agent, before touching secrets', async () => {
    mockKey = 'sk-should-not-matter';
    await expect(resolveLlmProvider('My Agent', 'anthropic')).rejects.toThrow(UnsupportedProviderError);
    await expect(resolveLlmProvider('My Agent', 'openai')).rejects.toThrow(/doesn't support yet/);
  });

  it('throws MissingApiKeyError when OPENROUTER_API_KEY is unset', async () => {
    mockKey = undefined;
    await expect(resolveLlmProvider('My Agent', 'openrouter')).rejects.toThrow(MissingApiKeyError);
  });

  it('returns an openrouter LLMProvider when the key is present', async () => {
    mockKey = 'sk-or-v1-fake';
    const llm = await resolveLlmProvider('My Agent', 'openrouter');
    expect(llm.id).toBe('openrouter');
  });
});
