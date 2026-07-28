# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session protocol

**Before starting work**, read the `INSIGHTS.md` of the module you are about to
touch, plus the root `INSIGHTS.md`. These hold findings earlier sessions paid for
the hard way — non-obvious dependencies, confirmed fixes, measured numbers,
gotchas — that are not visible from the code itself. Treat them as
high-confidence guidance. They are dated and append-only, though, so an entry can
have been overtaken by later changes: when one is about to steer a decision,
check the `file:line` it cites still says what it claims.

**At the end of a coding task**, invoke the `engineering-insights` skill to record
what this session learned. Do not skip it because the task felt small — the
question is whether anything was learned, not how big the diff was. If nothing
cleared the bar, recording nothing is the correct outcome.

## Stack & repository structure

**This is not a monorepo workspace.** It is four standalone packages, each with
its own `package.json` and lockfile. Cross-package code is shared through
**tsconfig path aliases** consuming TypeScript *source* directly — never through
published/built modules.

| Folder           | Package                    | What it is                                          | Port |
|------------------|----------------------------|-----------------------------------------------------|------|
| `server/`        | `@devdigest/api`           | Fastify 5 + Drizzle ORM + Postgres (pgvector)       | 3001 |
| `client/`        | `@devdigest/web`           | Next.js 15 App Router, React 19, TanStack Query      | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure review engine: diff → prompt → LLM → findings   | —    |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e (agent-browser, no LLM)    | —    |
| `server/src/vendor/shared` | `@devdigest/shared` | Zod contracts shared by every package             | —    |

Only **Postgres** runs in Docker; API and web run on the host.

**Package manager is mixed** — match the lockfile that exists in the package:
`client/` → pnpm · `reviewer-core/`, `e2e/` → npm · `server/` has **both**
`pnpm-lock.yaml` and `package-lock.json` (docs and CI use pnpm there).

### Architecture

End-to-end flow: **add repo** → server clones it and `repo-intel` indexes it →
**import PRs** from GitHub → **run review** → `reviewer-core` assembles a prompt
from diff + repo map → LLM → grounding gate → persisted findings → UI.

- **`reviewer-core` is pure.** No DB, GitHub, or filesystem; the only side effect
  is an LLM call through an **injected** `LLMProvider`. That is what makes it
  mock-testable. It never emits JS — its `build` is a type-check.
- **`repo-intel` lives inside the server** at `server/src/modules/repo-intel`
  (not a separate package). It powers the *Indexed* badge and feeds the repo map
  into review prompts.
- **DI container** (`server/src/platform/container.ts`) sits between services and
  adapters (llm · github · git · astgrep · tokenizer · secrets), so tests swap in
  `server/src/adapters/mocks.ts`.
- **Modules are registered statically** in `server/src/modules/index.ts` — one
  import + one `app.register` each. Plugins (helmet, cors, rate-limit, SSE)
  register *before* modules so encapsulated module plugins inherit them.
- **Zod contracts double as route schemas** via `fastify-type-provider-zod`: one
  definition drives request validation *and* response serialization. Invalid
  input is rejected with `422` before the handler runs — do not hand-roll
  `Schema.parse(req.body)` in handlers.
- **Review execution is backgrounded.** `POST /pulls/:id/review` returns
  immediately; `ReviewRunExecutor` (`modules/reviews/run-executor.ts`) runs the
  agents, streams `RunEvent`s over the in-memory `runBus` (SSE at
  `/runs/:id/events`), and persists a single `RunTrace` document per run.
  Per-agent failures are isolated; pre-work failures (e.g. diff load) fail every
  queued run.
- **Local-first reads.** PR list/detail sync from GitHub when a token exists but
  **never fail the read** — persisted/seeded data stays viewable offline.

## Commands

### Boot from zero

```sh
./scripts/dev.sh          # Postgres + .env files + deps + migrate + seed + API + web
```

Flags: `--no-seed` · `--no-client` · `--db-only` · `--help`.

Manual equivalent:

```sh
docker compose up -d                                   # Postgres + pgvector
cd server && pnpm install && pnpm db:migrate && pnpm dev
cd client && pnpm install && pnpm dev
```

**Migrations are not applied on boot.** `relation ... does not exist` on first
run means you skipped `pnpm db:migrate`.

### Per package

```sh
# server (pnpm)
pnpm dev · pnpm build · pnpm typecheck · pnpm test
pnpm db:migrate · pnpm db:seed · pnpm db:generate

# client (pnpm)
pnpm dev · pnpm build · pnpm typecheck · pnpm test

# reviewer-core (npm) — build IS the typecheck
npm test · npm run typecheck
```

### Tests

The server suite splits **by filename**, not by script:

```sh
cd server
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, hermetic, no Docker
pnpm exec vitest run .it.test                      # integration, needs Docker
pnpm test                                          # both
```

CI invokes these `vitest` commands directly rather than relying on committed
`test:unit` / `test:integration` scripts (see the `server/package.json` note in
`TESTING.md`).

Run a single test file or case:

```sh
pnpm exec vitest run src/path/to/file.test.ts
pnpm exec vitest run -t "name of the test"
```

Browser e2e (needs the full stack running):

```sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test     # or: npm run e2e:hermetic
```

Integration tests start a real Postgres via testcontainers and **self-skip when
Docker is absent** — a green run does not prove they executed.

There is **no lint script** in any package; `typecheck` is the static gate.

## Naming conventions

- **Packages** are scoped `@devdigest/*`.
- **Database:** tables and columns are `snake_case` in SQL, `camelCase` in the
  Drizzle schema — e.g. `headSha: text('head_sha')`. The Drizzle schema
  (`server/src/db/schema.ts`) is a **barrel** re-exporting `schema/<domain>.ts`;
  consumers always import from `db/schema`.
- **Wire contracts are `snake_case`.** Zod contracts in `@devdigest/shared`
  serialize `head_sha`, `files_count`, `opened_at` — so the camelCase↔snake_case
  mapping happens explicitly at the route boundary. Contracts live in
  `server/src/vendor/shared/contracts/<domain>.ts`.
- **Server modules:** `modules/<name>/` with `routes.ts` (HTTP + schemas),
  `service.ts` (orchestration), `repository.ts` (data access). When a module's
  data access grows, it splits into `repository/<entity>.repo.ts`
  (e.g. `pull.repo.ts`, `review.repo.ts`, `run.repo.ts`).
- **Client:** pages (`src/app/**/page.tsx`) stay thin; feature logic sits in
  colocated `_components/<Name>/` folders containing `<Name>.tsx`, `index.ts`,
  and — as needed — `styles.ts`, `helpers.ts`, `constants.ts`, `<Name>.test.tsx`.
  Data hooks live in `src/lib/hooks/*` over `src/lib/api.ts`.
- **Tests:** `*.it.test.ts` = DB-backed integration. Everything else is
  hermetic. **Any test importing `test/helpers/pg.ts` must use the
  `.it.test.ts` suffix** or the unit/integration split breaks.
- **E2E specs:** `e2e/specs/NN-name.flow.json`, deterministic batch JSON using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **Migrations:** `NNNN_name.sql`, generated by drizzle-kit.

## Do not touch

**Migrations (`server/src/db/migrations/*.sql`)** — never edit an applied
migration. Change `db/schema.ts`, then generate a new one with `pnpm db:generate`.
pgvector is enabled by migration `0000`; the `vector` type breaks if migrations
ran against a different database than the Dockerized one.

**The "unused" tables in the schema** — `db/schema.ts` intentionally contains
**every** table for the full product (skills, eval, ci, memory, plugins, …).
Tables that sit empty in the starter are filled by later course lessons. Do not
delete them as dead schema.

**Lockfiles** — never hand-edit. Use the package manager matching the lockfile
already in that package (see the mixed pnpm/npm note above); do not "unify" them
as a drive-by change.

**`agent-runner/dist/`** — not present in the starter (the CI runner arrives in
a later lesson), but `.gitignore` already carries an explicit negation for it.
When it lands, its bundled `dist/` **must** stay committed: it ships as a JS
GitHub Action and GitHub runs `action.yml`'s `main: dist/index.js` with no build
step. Do not "fix" that negation.

**Secrets** — API keys and `GITHUB_TOKEN` live in `~/.devdigest/secrets.json`
(mode `0600`) with `process.env` as fallback, never in git or the database. They
are **not** part of `AppConfig`. The single read chokepoint is
`LocalSecretsProvider` (`server/src/adapters/secrets/local.ts`) — do not read
secret env vars directly elsewhere.

**The grounding gate** (`groundFindings` in `reviewer-core/src/grounding.ts`) is
mandatory and must not be bypassed: a finding that does not cite a real line in
the diff is dropped, and the score is recomputed from the **surviving** findings.
The model's self-reported score is deliberately ignored.

**The injection guard** (`INJECTION_GUARD` in `reviewer-core/src/prompt.ts`) is one
shared, trusted rule appended to every agent's system prompt. Prompt-injection
defense is deliberately **not** keyword/denylist scanning of untrusted text — a
denylist only catches one phrasing. Untrusted content (diff, PR body, comments)
is fenced via `wrapUntrusted()`.

**`server/clones/`** — runtime data (cloned repos), git-ignored, never collected
by any test suite.
