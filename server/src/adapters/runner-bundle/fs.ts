import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerBundleFile, RunnerBundleReader } from '@devdigest/shared';

/**
 * Reads whatever `agent-runner`'s `pnpm build` (ncc) produced under
 * `agent-runner/dist/` — the real, disk-backed implementation of
 * `RunnerBundleReader`. Moved here from `ci/service.ts` (coordinator fix,
 * `architecture-reviewer` finding): the service layer must not call
 * `node:fs` directly — this is the port's one concrete adapter, resolved
 * through `Container.runnerBundleReader`, exactly like `GitClient`/
 * `GitHubClient`.
 *
 * Throws (never returns an empty/partial result) when the directory is
 * missing or empty — `agent-runner/dist/` is git-ignored-with-a-negation
 * (root `.gitignore`) and only exists after that package's own build step
 * has run; a missing bundle is a deployment/build-order problem for the
 * caller (`CiService`) to turn into a `ConfigError`, not a silent empty
 * file list.
 */
export class FsRunnerBundleReader implements RunnerBundleReader {
  constructor(private distDir: string) {}

  readFiles(): RunnerBundleFile[] {
    const names = readdirSync(this.distDir).filter((name) => statSync(join(this.distDir, name)).isFile());
    if (names.length === 0) {
      throw new Error(`agent-runner bundle directory ${this.distDir} is empty — run \`pnpm build\` in agent-runner/.`);
    }
    return names
      .sort()
      .map((name) => ({ name, contents: readFileSync(join(this.distDir, name), 'utf8') }));
  }
}
