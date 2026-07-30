## Session protocol

Before touching a module, read its `INSIGHTS.md` (+ root `INSIGHTS.md`) —
dated, append-only findings from past sessions. Verify the `file:line` a
finding cites still holds before trusting it; entries can be overtaken by
later changes.

After a task that taught you something non-obvious (a fix, a gotcha, a
measured number), invoke the `engineering-insights` skill to record it. If
nothing cleared that bar, recording nothing is correct.

## Read when

- **End-to-end architecture / flow diagram** → `README.md`
- **Touching `server/**`** → `server/README.md` (request/DI flow, API map, env
  vars) + `server/CLAUDE.md` (conventions)
- **Touching `client/**`** → `client/README.md` (route map) + `client/CLAUDE.md`
- **Touching `reviewer-core/**`** → `reviewer-core/README.md` (pipeline) +
  `reviewer-core/CLAUDE.md`
- **Touching `e2e/**`** → `e2e/README.md` (spec format, hermetic runner) +
  `e2e/CLAUDE.md`
- **Writing or debugging any test** → `TESTING.md` (suite map, unit/integration
  split, CI path filters)

> Each package's `CLAUDE.md` is meant to auto-load when you touch a file in
> that folder — but that mechanism has a known bug in the VS Code extension
> (upstream issue #24987). If a per-package rule doesn't seem to apply, open
> its `CLAUDE.md` explicitly.

## Repo shape

Four standalone packages — **not** a workspace. Cross-package code is shared
through **tsconfig path aliases** to TS *source*, never built output.

| Folder | Package | Port |
|---|---|---|
| `server/` | `@devdigest/api` | 3001 |
| `client/` | `@devdigest/web` | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | — |
| `e2e/` | `@devdigest/e2e` | — |
| `server/src/vendor/shared` | `@devdigest/shared` | — |

Only Postgres runs in Docker. **Package manager is mixed** — match the
lockfile already in the package: `client/` → pnpm · `reviewer-core/`, `e2e/` →
npm · `server/` has both (pnpm is canonical for it).

## Cross-cutting conventions

**Wire contracts are `snake_case`** (`head_sha`, `files_count`) even though the
Drizzle schema and TS are `camelCase` — the mapping happens explicitly at the
route boundary. Contracts live in `server/src/vendor/shared/contracts/`.

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

The full unit/integration test split (per-package suites, CI path filters) is
in `TESTING.md`.

## Do not touch

**Migrations (`server/src/db/migrations/*.sql`)** — never edit an applied one;
change `db/schema.ts` and generate a new one (`pnpm db:generate`). pgvector is
enabled by migration `0000`.

**"Unused" tables in `db/schema.ts`** — the schema intentionally holds every
table for the full product; later lessons fill the empty ones. Don't delete
them as dead schema.

**Lockfiles** — never hand-edit; don't "unify" the mixed pnpm/npm setup as a
drive-by change.

**`agent-runner/dist/`** — not present yet (arrives with the CI-runner lesson),
but `.gitignore` already carries an explicit negation for it. When it lands,
the bundled `dist/` **must** stay committed — it ships as a JS GitHub Action
with no build step. Don't "fix" that negation.

**Secrets** — API keys / `GITHUB_TOKEN` live in `~/.devdigest/secrets.json`
(mode `0600`), `process.env` as fallback, never in git/DB/`AppConfig`. Single
read chokepoint: `server/src/adapters/secrets/local.ts`.

**The grounding gate** (`reviewer-core/src/grounding.ts`) — mandatory, never
bypassed: an ungrounded finding is dropped and the score is recomputed from the
survivors. The model's self-reported score is ignored.

**The injection guard** (`INJECTION_GUARD` in `reviewer-core/src/prompt.ts`) —
one shared rule on every agent's system prompt, deliberately not a
keyword/denylist scan of untrusted text (diff/PR body/comments, wrapped via
`wrapUntrusted()`).
