import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

/**
 * promptLogVerbose is a LOCAL-ONLY debug toggle for prompt-assembly logging
 * (full per-section breakdown vs. just aggregate totals) — it must never be
 * true in production, even if the env var is mistakenly set there.
 */
describe('loadConfig — promptLogVerbose (local-only safety gate)', () => {
  it('is false by default', () => {
    expect(loadConfig({}).promptLogVerbose).toBe(false);
  });

  it('is true when explicitly enabled outside production', () => {
    expect(
      loadConfig({ PROMPT_LOG_VERBOSE: 'true', NODE_ENV: 'development' }).promptLogVerbose,
    ).toBe(true);
    expect(
      loadConfig({ PROMPT_LOG_VERBOSE: 'true', NODE_ENV: 'test' }).promptLogVerbose,
    ).toBe(true);
  });

  it('is forced false in production regardless of the env var', () => {
    expect(
      loadConfig({ PROMPT_LOG_VERBOSE: 'true', NODE_ENV: 'production' }).promptLogVerbose,
    ).toBe(false);
  });

  it('any value other than the literal string "true" is treated as off', () => {
    expect(
      loadConfig({ PROMPT_LOG_VERBOSE: '1', NODE_ENV: 'development' }).promptLogVerbose,
    ).toBe(false);
  });
});
