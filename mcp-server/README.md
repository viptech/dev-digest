# `@devdigest/mcp-server` — devdigest-mcp

A local, stdio-transport [MCP](https://modelcontextprotocol.io) server that lets
Claude Code / Claude Desktop drive DevDigest's existing Fastify API (`server/`,
port `3001`) through 6 read-mostly tools, without duplicating DevDigest's
business logic. It is a thin client: every tool takes the internal ids
(`agent_id`, `pr_id`, `repo_id` — as returned by `list_agents`/`list_pulls` or
copied from the DevDigest studio URL) and calls the API over `fetch` directly,
no name/number resolution step.

## Tools

| Tool | Purpose |
|---|---|
| `list_agents` | List configured review agents (id, name, provider, model, enabled). Call first to discover a valid `agent_id`. |
| `list_pulls` | List PRs for a repo, by `repo_id`. Call this to discover a valid `pr_id` — `gh`/GitHub MCP know GitHub's own PR numbers, never DevDigest's internal `pr_id`. `open_only:true` drops merged/closed PRs. |
| `run_agent_on_pr` | Start a review run for `agent_id` + `pr_id`, poll up to ~60s, return `{ verdict, score, findings }` (or `{ run_id, status: 'running' }` if still in progress). |
| `get_findings` | Fetch findings for a PR by `pr_id`, grouped one entry per review run (a PR reviewed by several agents gets several entries), not a single flat list. |
| `get_conventions` | Fetch already-extracted coding conventions for a repo, by `repo_id`. Read-only — never triggers new extraction. |
| `get_blast_radius` | Fetch the blast radius for a PR by `pr_id`: changed symbols, their callers (file:line), and potentially affected HTTP endpoints/crons — computed from the repo's persistent code index, no LLM call. |

**Note on `list_pulls`:** the course's lab notes (`README.md`'s roadmap,
`04-hands-on-lab.md:22`) deliberately skip a `list_prs` tool, reasoning that
`gh`/GitHub MCP already list PRs. That holds for GitHub's own PR identity
(owner/repo#number) but not for DevDigest's internal `pr_id` — the id every
other tool here actually needs — which neither `gh` nor GitHub MCP can ever
know. Without `list_pulls`, getting a `pr_id` requires a human to open the
Studio UI first, even when an agent already knows a PR exists (e.g. from
GitHub MCP). This tool closes exactly that gap and nothing else — no
title/author filtering, no repo listing (that part of the course's reasoning
still applies to `list_repos`, so it's not added here).

## Prerequisites

- The DevDigest API running locally (`./scripts/dev.sh` from the repo root, or
  `cd server && pnpm dev`) — defaults to `http://localhost:3001`.
- Node.js (for `npx`/`tsx`) and this package's dependencies installed:

  ```sh
  cd mcp-server
  npm install
  ```

## Not started by `./scripts/dev.sh`

This package is deliberately **not** wired into the root dev script — booting
the rest of the app (Postgres, `server/`, `client/`) never starts this MCP
server as a side effect. It only runs when an MCP client (Claude Code, Claude
Desktop) spawns it over stdio per its own config (see below), or when you run
it manually (`npm start`). Registering/deregistering it with your MCP client
is the on/off switch — see "Configuring Claude Code / Claude Desktop" below.

## Configuring Claude Code / Claude Desktop

**Use `start.sh`, not a raw `npx tsx`/`tsx` command.** `tsx` resolves this
package's `tsconfig.json` `paths` alias (`@devdigest/shared`) relative to the
spawned process's **working directory**, not the entry file's location. Some
MCP clients don't let you set that working directory at all — confirmed on
Claude Code: `claude mcp add` has no `--cwd` flag, and `claude mcp add-json`
silently drops a `cwd` field from the stored config (verified by inspecting
`~/.claude.json` after adding one). Without the right cwd, startup fails with
`ERR_MODULE_NOT_FOUND: Cannot find package '@devdigest/shared'` and the MCP
client reports a generic `-32000: Connection closed` — no hint that cwd was
the cause. `start.sh` (`cd "$(dirname "$0")" && exec ./node_modules/.bin/tsx
src/index.ts`) sidesteps this entirely by fixing its own cwd first, so it
works regardless of what cwd the client spawns it with.

**Claude Code**, local scope (private to you, not committed, not shared via
`.mcp.json`):

```sh
claude mcp add devdigest -s local -e DEVDIGEST_API_URL=http://localhost:3001 \
  -- "/absolute/path/to/dev-digest/mcp-server/start.sh"
claude mcp get devdigest   # should show "✔ Connected"
```

Remove it when done: `claude mcp remove devdigest -s local`.

**Claude Desktop** (`claude_desktop_config.json`) — same idea, point `command`
at the absolute path to `start.sh`, no `args` needed:

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "/absolute/path/to/dev-digest/mcp-server/start.sh",
      "env": {
        "DEVDIGEST_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

(Desktop's config format does document a `cwd` field, and it may well honor
it correctly — but `start.sh` makes the entry work identically everywhere
without depending on that, so there's no reason to rely on it.)

Equivalently, `npm start` runs the same `tsx src/index.ts` entry point (see
`package.json`'s `start` script) — useful for a quick manual check that the
process boots without errors (it will sit waiting on stdio, so run it with a
real MCP client, not standalone in a terminal, to actually exercise a tool).

**On-demand only, not always-on:** avoid adding this to the repo's shared
`.mcp.json` (that auto-connects for every Claude Code session in this repo,
for every teammate). Prefer registering/removing it per session with the CLI
(see the exact `claude mcp add ... start.sh` command above), or add it once
under `--scope local`/`user` and toggle it off between uses via `/mcp` inside
a Claude Code session (check `claude mcp --help` / `/mcp` for the exact flags
in your installed version — the CLI surface evolves).

## `DEVDIGEST_API_URL`

Every request goes through `src/http-client.ts`, which reads
`process.env.DEVDIGEST_API_URL` and falls back to `http://localhost:3001` when
unset. Set it in the MCP config's `env` block (as above) to point this server
at a different host/port — e.g. a non-default `pnpm dev` port, or a remote
deployment. No auth headers are sent (the API's `LocalNoAuthProvider` always
resolves the same local workspace/user, so there is nothing to authenticate
locally).

## Pre-push CLI: `devdigest review --mode working`

Runs the SAME Structured Reviewer engine (`reviewPullRequest`,
`@devdigest/reviewer-core`) and the same domain logic the web UI uses for a
PR, against your local git working tree — before you even open a PR.

```sh
cd mcp-server
./bin/devdigest-review.sh --mode working --agent "Security Reviewer"
# or, for local dev without a global install:
npm run review:working -- --agent "Security Reviewer"
```

`--mode working` diffs staged + unstaged changes to already-tracked files
(`git diff HEAD`) — brand-new, never-`git add`ed files are **not** included;
stage them first if they should be reviewed. Only `--mode working` is
implemented; `--mode staged`/`--mode branch` are reserved for later.

Requires the DevDigest API running locally (for the agent's config —
`GET /agents`) and an `OPENROUTER_API_KEY` configured (checked via the same
`server/src/adapters/secrets/local.ts` this whole app uses — never a second
secrets reader — falling back to the environment). Only `provider:
'openrouter'` agents are supported today; `openai`/`anthropic` agents fail
with a clear message pointing at an openrouter alternative.

**Exit codes**: `0` review ran clean (no `CRITICAL` finding, or nothing to
review) · `1` review ran, at least one `CRITICAL` finding · `2` the review
couldn't run at all (bad args, not a git repo, unknown agent, unsupported
provider, missing key, request failure). Full `--help` output documents this
same contract.

`bin/devdigest-review.sh` exists for the same cwd reason `start.sh` does —
`tsx` needs its own cwd = `mcp-server/` to resolve this package's path
aliases, but the CLI itself needs your original cwd to find the git repo
being reviewed. The wrapper captures your shell's cwd into
`DEVDIGEST_CLI_CWD` before `cd`-ing, so both work correctly at once.

## Development

```sh
npm install       # install deps
npm run typecheck # tsc --noEmit
npm test          # vitest run — unit tests only, no real network/API needed
npm start         # tsx src/index.ts — runs the server over stdio
```

Contracts (`Agent`, `Repo`, `PrMeta`, `Finding`, `ReviewRecord`, …) are
imported from the server's vendored shared package via a tsconfig path alias
(`@devdigest/shared` → `../server/src/vendor/shared/index.ts`) — no separate
copy is kept here (see root `INSIGHTS.md`'s note on contract-copy drift; this
package deliberately avoids adding a third one).

