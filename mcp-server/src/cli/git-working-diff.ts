import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UnifiedDiff } from '@devdigest/shared';
// Relative cross-package source import — the same established precedent as
// `reviewer-core/test/run.test.ts`'s `../../server/src/adapters/mocks.js`
// (this monorepo has no npm workspaces, so cross-package code is shared via
// TS source imports, per root CLAUDE.md).
import { parseUnifiedDiff } from '../../../server/src/adapters/git/diff-parser.js';

const run = promisify(execFile);

/**
 * `--mode working`: diffs the CURRENT WORKING TREE, not a PR. No existing
 * adapter does this — `SimpleGitClient` (server/src/adapters/git/simple-git.ts)
 * only diffs two committed refs inside a DevDigest-managed clone, with no
 * concept of "the repo at the CLI's cwd". This shells out directly instead.
 *
 * `git diff HEAD` covers staged AND unstaged changes to already-tracked
 * files. It does NOT include untracked (new, never-`git add`ed) files —
 * documented as a known limitation in the CLI's --help text rather than
 * silently pretending they don't exist.
 */
export class NotAGitRepoError extends Error {
  constructor() {
    super('Not inside a git repository (git rev-parse --show-toplevel failed).');
    this.name = 'NotAGitRepoError';
  }
}

export async function findGitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new NotAGitRepoError();
  }
}

/** `git diff HEAD` from the repo root, parsed into a `UnifiedDiff`. */
export async function getWorkingTreeDiff(repoRoot: string): Promise<UnifiedDiff> {
  const { stdout } = await run('git', ['diff', 'HEAD'], { cwd: repoRoot, maxBuffer: 1024 * 1024 * 64 });
  return parseUnifiedDiff(stdout);
}
