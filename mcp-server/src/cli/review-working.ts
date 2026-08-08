#!/usr/bin/env node
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseArgs } from './args.js';
import { EXIT_CLEAN, EXIT_COULD_NOT_RUN, determineExitCode, formatFindings } from './format.js';
import { findGitRoot, getWorkingTreeDiff, NotAGitRepoError } from './git-working-diff.js';
import { resolveAgent } from './resolve-agent.js';
import { resolveLlmProvider } from './llm-provider.js';

/**
 * `devdigest review --mode working` — runs the SAME Structured Reviewer
 * engine (`reviewPullRequest`, `@devdigest/reviewer-core`) and the SAME
 * domain logic the web UI uses for a PR, against the developer's local git
 * working tree instead. No second review implementation: this file is
 * wiring (git diff -> UnifiedDiff, agent config lookup, LLM provider
 * construction, terminal output) around the one engine every review path in
 * this codebase already shares.
 *
 * `--mode working` only. `--mode staged`/`--mode branch` are NOT implemented
 * here — the flag is validated so a future mode can be added without a
 * breaking CLI surface change, but this file only ever builds a working-tree
 * diff.
 *
 * Exit code contract (see printHelp() below for the user-facing copy, and
 * `format.ts` for the constants):
 *   0 — review ran, no CRITICAL-severity findings (or nothing to review).
 *   1 — review ran, at least one CRITICAL-severity finding.
 *   2 — the review could not run at all (bad args, not a git repo, unknown
 *       agent, unsupported provider, missing API key, or an LLM/network
 *       failure).
 *
 * Pure/testable pieces live in sibling files (`args.ts`, `format.ts`,
 * `resolve-agent.ts`, `git-working-diff.ts`, `llm-provider.ts`) — this file
 * is the thin, mostly-untested orchestration entry point.
 */

function printHelp(): void {
  process.stdout.write(
    `devdigest review --mode working [--agent <name>]

Reviews the current git working tree's uncommitted changes (staged +
unstaged, tracked files only — see the note below) using the same
Structured Reviewer engine and domain logic DevDigest's web UI uses for a
pull request.

Options:
  --mode <mode>    Required. Only "working" is implemented today. Reserved
                    for future "staged"/"branch" modes.
  --agent <name>   Required. Name of a configured DevDigest review agent
                    (case-insensitive exact match), e.g. "Security Reviewer".
                    Must be an agent backed by the 'openrouter' provider —
                    this CLI does not yet support 'openai'/'anthropic' agents.
  -h, --help       Show this help and exit 0.

Untracked files: "git diff HEAD" (what --mode working uses) covers staged
and unstaged changes to files git ALREADY tracks. Brand-new files you have
not "git add"ed are NOT included — stage them first if they should be part
of the review.

Requires the DevDigest API running locally (DEVDIGEST_API_URL, default
http://localhost:3001) to look up the agent's config, and an
OPENROUTER_API_KEY configured (~/.devdigest/secrets.json or the
environment) to run the review.

Exit codes:
  0   Review ran; no CRITICAL-severity findings (or nothing to review).
  1   Review ran; at least one CRITICAL-severity finding.
  2   The review could not run at all (bad args, not a git repo, unknown
      agent, unsupported provider, missing API key, or a request failure).
`,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return EXIT_CLEAN;
  }

  if (args.mode !== 'working') {
    process.stderr.write(
      `error: --mode must be "working" (got ${args.mode ? `"${args.mode}"` : 'nothing'}) — ` +
        `"staged"/"branch" modes are reserved but not implemented yet.\n\n`,
    );
    printHelp();
    return EXIT_COULD_NOT_RUN;
  }
  if (!args.agent) {
    process.stderr.write('error: --agent <name> is required.\n\n');
    printHelp();
    return EXIT_COULD_NOT_RUN;
  }

  try {
    // `bin/devdigest-review.sh` sets this to the caller's original cwd before
    // `cd`-ing into mcp-server/ so tsx can resolve its own path aliases —
    // `process.cwd()` here would otherwise be mcp-server/, not the repo
    // being reviewed. Falls back to raw `process.cwd()` for `npm start`-style
    // direct invocation (no wrapper), where no such conflict exists.
    const startCwd = process.env.DEVDIGEST_CLI_CWD ?? process.cwd();
    const repoRoot = await findGitRoot(startCwd);
    const diff = await getWorkingTreeDiff(repoRoot);

    if (diff.files.length === 0) {
      process.stdout.write('No uncommitted changes to review (git diff HEAD is empty).\n');
      return EXIT_CLEAN;
    }

    const agent = await resolveAgent(args.agent);
    const llm = await resolveLlmProvider(agent.name, agent.provider);

    process.stdout.write(
      `Reviewing ${diff.files.length} changed file(s) in ${repoRoot} with '${agent.name}'...\n`,
    );

    const outcome = await reviewPullRequest({
      systemPrompt: agent.system_prompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy,
      task: 'Review the uncommitted changes in the local git working tree.',
    });

    process.stdout.write(formatFindings(outcome.review.findings));
    process.stdout.write(
      `\nverdict=${outcome.review.verdict} score=${outcome.review.score} grounding=${outcome.grounding}\n`,
    );

    return determineExitCode(outcome.review.findings);
  } catch (err) {
    const message = err instanceof NotAGitRepoError ? err.message : err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    return EXIT_COULD_NOT_RUN;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: unexpected failure: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT_COULD_NOT_RUN);
  },
);
