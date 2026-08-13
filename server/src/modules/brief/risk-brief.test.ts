import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { INJECTION_GUARD } from '@devdigest/reviewer-core';
import type { Brief } from '@devdigest/shared';
import { assembleBriefInput, callBrief } from './risk-brief.js';
import { MAX_DIFF_STAT_FILES } from './constants.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import type { PullRow, PersistedIntent } from '../reviews/repository.js';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Hermetic unit tests for `assembleBriefInput`/`callBrief` — stub `Container`
 * fields directly, same minimal-stub pattern
 * `conventions-file-guard.test.ts` uses for `ConventionsService.extract`. No
 * Postgres needed: `container.db` is only reached by `SmartDiffRepository`'s
 * `select().from(t.prFiles).where(...)` chain, stubbed to return the fixture
 * `prFiles` array regardless of the actual query.
 */

type PrFileFixture = { path: string; additions: number; deletions: number; patch: string | null };

const REPO_ROW = { id: 'repo-1', owner: 'acme', name: 'demo' };

function pull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rate-limit',
    base: 'main',
    headSha: 'sha123',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'open',
    body: 'Adds rate limiting to the public API.',
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

interface FakeContainerOptions {
  prFiles?: PrFileFixture[];
  intent?: PersistedIntent;
  reviewsForPull?: { review: { kind: string; agentId: string | null } }[];
  blastResult?: Partial<BlastResult>;
  linkedIssue?: { number: number; title: string; body?: string | null } | null;
  specDocs?: { repoId: string; owner: string; name: string; path: string }[];
  specFiles?: Record<string, string>;
  llm?: MockLLMProvider;
  resolveAgentContextSpy?: ReturnType<typeof vi.fn>;
}

function buildContainer(opts: FakeContainerOptions = {}): Container {
  const prFiles = opts.prFiles ?? [{ path: 'src/config.ts', additions: 5, deletions: 1, patch: null }];
  const resolveAgentContext =
    opts.resolveAgentContextSpy ?? vi.fn(async () => opts.specDocs ?? []);
  return {
    db: {
      select: () => ({ from: () => ({ where: async () => prFiles }) }),
    },
    reviewRepo: {
      getIntent: async () => opts.intent,
      reviewsForPull: async () => opts.reviewsForPull ?? [],
    },
    repoIntel: {
      getBlastRadius: async () =>
        ({ changedSymbols: [], callers: [], impactedEndpoints: [], ...opts.blastResult }) as BlastResult,
      readFiles: async (_repoId: string, paths: string[]) =>
        paths
          .map((p) => ({ path: p, content: opts.specFiles?.[p] ?? '' }))
          .filter((f) => f.content.length > 0),
    },
    projectContext: { resolveAgentContext },
    github: async () => ({
      getPullRequest: async () => ({
        linked_issue: opts.linkedIssue === undefined ? null : opts.linkedIssue,
      }),
    }),
    llm: async () => opts.llm ?? new MockLLMProvider('openai', {}),
  } as unknown as Container;
}

const FIXTURE_BRIEF: Brief = {
  what: 'Adds rate limiting.',
  why: 'Prevents abuse.',
  risk_level: 'medium',
  risks: [],
  review_focus: [],
};

describe('assembleBriefInput — wrapping (NFR HIGH)', () => {
  it('wraps title/description, intent, blast summary, linked-issue, and spec content each individually via wrapUntrusted', async () => {
    const container = buildContainer({
      intent: {
        intent: 'Add limiter',
        in_scope: [],
        out_of_scope: [],
        confidence: 'high',
        source: 'description',
        providerUsed: 'openai',
        modelUsed: 'gpt-4.1',
        headSha: 'sha123',
      },
      reviewsForPull: [{ review: { kind: 'review', agentId: 'agent-1' } }],
      specDocs: [{ repoId: 'repo-1', owner: 'acme', name: 'demo', path: 'docs/spec.md' }],
      specFiles: { 'docs/spec.md': 'Spec content here.' },
      linkedIssue: { number: 5, title: 'Bug', body: 'Issue body text' },
    });

    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');

    expect(inputs.userMessage).toContain('<untrusted source="pr-description">');
    expect(inputs.userMessage).toContain('<untrusted source="intent">');
    expect(inputs.userMessage).toContain('<untrusted source="blast">');
    expect(inputs.userMessage).toContain('<untrusted source="linked-issue">');
    expect(inputs.userMessage).toContain('<untrusted source="spec-0">');
    expect(inputs.userMessage).toContain('Spec content here.');
    expect(inputs.userMessage).toContain('Issue body text');
  });

  it('omits the intent section entirely (not wrapped-but-empty) when getIntent returns undefined', async () => {
    const container = buildContainer({ intent: undefined });
    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');
    expect(inputs.userMessage).not.toContain('source="intent"');
  });

  it('omits "relevant specs" entirely when a review exists but its agentId is null (M6), while intent/blast/diff-stats/linked-issue still assemble normally', async () => {
    const resolveAgentContextSpy = vi.fn(async () => [
      { repoId: 'repo-1', owner: 'acme', name: 'demo', path: 'docs/spec.md' },
    ]);
    const container = buildContainer({
      intent: {
        intent: 'Add limiter',
        in_scope: [],
        out_of_scope: [],
        confidence: 'high',
        source: 'description',
        providerUsed: 'openai',
        modelUsed: 'gpt-4.1',
        headSha: 'sha123',
      },
      reviewsForPull: [{ review: { kind: 'review', agentId: null } }],
      specFiles: { 'docs/spec.md': 'Spec content here.' },
      linkedIssue: { number: 5, title: 'Bug', body: 'Issue body text' },
      resolveAgentContextSpy,
    });

    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');

    expect(resolveAgentContextSpy).not.toHaveBeenCalled();
    expect(inputs.userMessage).not.toContain('source="spec-0"');
    expect(inputs.userMessage).toContain('source="intent"');
    expect(inputs.userMessage).toContain('source="blast"');
    expect(inputs.userMessage).toContain('source="linked-issue"');
    expect(inputs.userMessage).toContain('DIFF STATS:');
  });

  it('omits "relevant specs" entirely when the PR has no review yet', async () => {
    const resolveAgentContextSpy = vi.fn(async () => []);
    const container = buildContainer({ reviewsForPull: [], resolveAgentContextSpy });
    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');
    expect(resolveAgentContextSpy).not.toHaveBeenCalled();
    expect(inputs.userMessage).not.toContain('source="spec-0"');
  });
});

describe('assembleBriefInput — diff stats (never patch, always capped)', () => {
  it('never includes pr_files.patch in the assembled userMessage, even when a fixture file has a non-null patch', async () => {
    const container = buildContainer({
      prFiles: [{ path: 'src/secret.ts', additions: 1, deletions: 0, patch: 'SUPER_SECRET_PATCH_BODY' }],
    });
    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');
    expect(inputs.userMessage).not.toContain('SUPER_SECRET_PATCH_BODY');
  });

  it('truncates the rendered file list at MAX_DIFF_STAT_FILES, always keeping the aggregate stat line', async () => {
    const many: PrFileFixture[] = Array.from({ length: MAX_DIFF_STAT_FILES + 5 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: 1,
      deletions: 0,
      patch: null,
    }));
    const container = buildContainer({ prFiles: many });
    const inputs = await assembleBriefInput(
      container,
      pull({ additions: 45, deletions: 0, filesCount: many.length }),
      REPO_ROW,
      'SYSTEM TEMPLATE',
    );
    expect(inputs.userMessage).toContain(`aggregate: +45/-0 across ${many.length} file(s)`);
    expect(inputs.userMessage).toContain('+5 more files (aggregate only)');
    const listedCount = (inputs.userMessage.match(/- src\/file\d+\.ts \(/g) ?? []).length;
    expect(listedCount).toBe(MAX_DIFF_STAT_FILES);
  });

  it('knownFileRefsUniverse/changedPaths are built from the FULL getPrFiles result, not the MAX_DIFF_STAT_FILES-truncated prompt list', async () => {
    // Sorted descending by churn — the LAST file (lowest churn) falls outside
    // the prompt's own MAX_DIFF_STAT_FILES cap, but must still ground.
    const many: PrFileFixture[] = Array.from({ length: MAX_DIFF_STAT_FILES + 1 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: MAX_DIFF_STAT_FILES - i,
      deletions: 0,
      patch: null,
    }));
    const container = buildContainer({ prFiles: many });
    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, 'SYSTEM TEMPLATE');

    const truncatedOutPath = `src/file${MAX_DIFF_STAT_FILES}.ts`; // lowest churn, index MAX
    expect(inputs.userMessage).not.toContain(`- ${truncatedOutPath} (`);
    expect(inputs.changedPaths.has(truncatedOutPath)).toBe(true);
    expect(inputs.knownFileRefsUniverse.has(truncatedOutPath)).toBe(true);
  });
});

describe('assembleBriefInput — AC-2 total-budget check (M2)', () => {
  it('accounts for systemPromptTemplate + guard length, not just userMessage.length, and drops specs first when over budget', async () => {
    const container = buildContainer({
      intent: {
        intent: 'Add limiter',
        in_scope: [],
        out_of_scope: [],
        confidence: 'high',
        source: 'description',
        providerUsed: 'openai',
        modelUsed: 'gpt-4.1',
        headSha: 'sha123',
      },
      reviewsForPull: [{ review: { kind: 'review', agentId: 'agent-1' } }],
      specDocs: [{ repoId: 'repo-1', owner: 'acme', name: 'demo', path: 'docs/spec.md' }],
      specFiles: { 'docs/spec.md': 'Spec content that should get dropped.' },
      linkedIssue: { number: 5, title: 'Bug', body: 'Issue body' },
    });
    // Alone, ~10000 tokens (40000 chars / 4) — already over MAX_BRIEF_INPUT_TOKENS
    // (8000) before userMessage is even added. Every individual SECTION here
    // stays comfortably under its own per-section cap; only the passed-in
    // template length pushes the total over budget.
    const hugeSystemTemplate = 'x'.repeat(40000);

    const inputs = await assembleBriefInput(container, pull(), REPO_ROW, hugeSystemTemplate);

    expect(inputs.userMessage).not.toContain('source="spec-0"');
    expect(inputs.userMessage).not.toContain('Spec content that should get dropped.');
    expect(inputs.userMessage).toContain('source="intent"');
    expect(inputs.userMessage).toContain('source="blast"');
    expect(inputs.userMessage).toContain('source="linked-issue"');
    expect(inputs.userMessage).toContain('DIFF STATS:');
  });
});

describe('callBrief — injection guard ownership (B5) + AC-3 model passthrough', () => {
  it('appends INJECTION_GUARD to systemPrompt exactly once, immediately before sending', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    const container = { llm: async () => llm } as unknown as Container;

    await callBrief(container, {
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'SYSTEM TEMPLATE TEXT',
      userMessage: 'USER MESSAGE',
    });

    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    const req = call.req as { messages: { role: string; content: string }[] };
    const systemMsg = req.messages.find((m) => m.role === 'system')!.content;
    expect(systemMsg).toBe(`SYSTEM TEMPLATE TEXT\n\n${INJECTION_GUARD}`);
    expect(systemMsg.split(INJECTION_GUARD).length - 1).toBe(1); // exactly once
  });

  it('risk-brief.system.md template itself never contains the injection guard text (the guard is appended by callBrief, not baked into the template)', async () => {
    const templateUrl = new URL('../../prompts/risk-brief.system.md', import.meta.url);
    const raw = await readFile(templateUrl, 'utf8');
    expect(raw).not.toContain(INJECTION_GUARD);
  });

  it('passes the resolved provider/model straight through into the underlying LLM request (AC-3 — resolveFeatureModel itself is service.ts\'s job; this asserts callBrief\'s own passthrough contract)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Brief: FIXTURE_BRIEF } });
    const calledWith: string[] = [];
    const container = {
      llm: async (id: string) => {
        calledWith.push(id);
        return llm;
      },
    } as unknown as Container;

    await callBrief(container, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      systemPrompt: 'SYS',
      userMessage: 'USER',
    });

    expect(calledWith).toEqual(['openai']);
    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    expect((call.req as { model: string }).model).toBe('gpt-4.1-mini');
  });

  it('propagates a thrown LLM error uncaught — service.ts, not this module, owns the AC-13 degrade', async () => {
    const throwingLlm = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('nope');
      },
      completeStructured: async () => {
        throw new Error('LLM exploded');
      },
      embed: async () => [],
    };
    const container = { llm: async () => throwingLlm } as unknown as Container;

    await expect(
      callBrief(container, { provider: 'openai', model: 'gpt-4.1', systemPrompt: 'SYS', userMessage: 'USER' }),
    ).rejects.toThrow('LLM exploded');
  });
});
