/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — sections (safe, content-free logging metadata)', () => {
  it('reports name/source/chars/approxTokens for every rendered section, and nothing else', () => {
    const { sections } = assemblePrompt({
      system: 'AGENT-SYS',
      diff: 'DIFF-TEXT',
      prDescription: 'a PR body',
      intent: 'an intent string',
    });
    const byName = Object.fromEntries(sections.map((s) => [s.name, s]));

    expect(byName['system']).toEqual({
      name: 'system',
      source: 'agent-config',
      chars: 'AGENT-SYS'.length,
      approxTokens: Math.ceil('AGENT-SYS'.length / 4),
    });
    expect(byName['diff']).toMatchObject({ source: 'diff-loader', chars: 'DIFF-TEXT'.length });
    expect(byName['pr-description']).toMatchObject({ source: 'pr-body', chars: 'a PR body'.length });
    expect(byName['intent']).toMatchObject({ source: 'intent-service', chars: 'an intent string'.length });
    expect(byName['injection-guard']).toBeDefined();

    // Every entry has exactly these four keys — no `content`/`text`/`raw` field ever, by construction.
    for (const s of sections) {
      expect(Object.keys(s).sort()).toEqual(['approxTokens', 'chars', 'name', 'source']);
    }
  });

  it('omits sections for absent/empty optional fields (same contract as rendering)', () => {
    const { sections } = assemblePrompt({ system: 'sys', diff: 'DIFF' });
    const names = sections.map((s) => s.name);
    expect(names).toEqual(['system', 'injection-guard', 'diff']);
    expect(names).not.toContain('pr-description');
    expect(names).not.toContain('intent');
    expect(names).not.toContain('skills');
  });
});
