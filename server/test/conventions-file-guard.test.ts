import { describe, it, expect, vi } from 'vitest';
import { ConventionsService } from '../src/modules/conventions/service.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';

/**
 * The `.filter((f) => samples.includes(f))` guard in `extract()` is the ONLY
 * barrier between raw LLM output and `readFiles(repoId, <model-provided path>)`
 * — a path-traversal guard as much as a hallucination guard. This asserts it
 * actually strips paths the model invents (or tries to escape the clone with)
 * that were never in the offered `samples` list, before they ever reach
 * `readFiles`.
 *
 * No Postgres needed: `container.db` is only touched by
 * `resolveFeatureModel`'s settings lookup, which we stub to "no override" so
 * it falls back to the registry default; the service's own `repo` is patched
 * directly (see repo-intel-facade-degraded.test.ts for the same pattern) so
 * `list()` doesn't need a real DB either.
 */
describe('ConventionsService.extract — file-selection guard', () => {
  const SAMPLES = ['src/a.ts', 'src/b.ts'];

  function buildService(readFiles: ReturnType<typeof vi.fn>) {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        // Model response mixes one path that WAS offered with two it hallucinated
        // — one plain typo/hallucination, one an explicit traversal attempt.
        ConventionFileSelection: {
          files: ['src/a.ts', 'not-in-samples.ts', '../../etc/passwd'],
        },
        ConventionExtraction: { candidates: [] },
      },
    });

    const container = {
      db: {
        // Only reached by resolveFeatureModel's settings lookup — no override
        // configured, so it falls back to the registry default.
        select: () => ({ from: () => ({ where: async () => [] }) }),
      },
      repoIntel: {
        getConventionSamples: async () => SAMPLES,
        readFiles,
      },
      llm: async () => llm,
    } as unknown as Container;

    const service = new ConventionsService(container);
    // Bypass the real repository (would need Postgres) — extract() calls
    // repo.replaceUnaccepted then list(); both are irrelevant to this guard.
    (service as unknown as { repo: Record<string, unknown> }).repo = {
      replaceUnaccepted: async () => [],
      listByRepo: async () => [],
    };
    return service;
  }

  it('only passes samples-list paths to readFiles, dropping hallucinated/traversal paths', async () => {
    const readFiles = vi.fn(async (_repoId: string, paths: string[]) =>
      paths.map((p) => ({ path: p, content: 'x' })),
    );
    const service = buildService(readFiles);

    // 'llm' explicitly: this guard only exists in the 2-step LLM file-selection
    // branch — 'code' (the default since the sampling_mode homework task) never
    // calls ConventionFileSelection at all, so it wouldn't exercise this path.
    await service.extract('ws1', 'repo1', 'llm');

    // Only one readFiles call happens now: the guarded readFiles(repoId, selected)
    // for the files the model chose to read. verifyEvidence no longer issues its
    // own readFiles call — it verifies against this same in-memory `files` array,
    // so a candidate's evidence_path must match a path that was actually read.
    expect(readFiles).toHaveBeenCalledTimes(1);
    const [, passedPaths] = readFiles.mock.calls[0]!;
    expect(passedPaths).toEqual(['src/a.ts']);
    expect(passedPaths).not.toContain('../../etc/passwd');
    expect(passedPaths).not.toContain('not-in-samples.ts');
  });
});
