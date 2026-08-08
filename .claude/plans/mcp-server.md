# Development Plan — `mcp-server/` (devdigest-mcp), 5 MCP tools over the DevDigest API

## Decisions applied by default (user was AFK twice when asked — proceeding with the Recommended option each time; revisit any of these before/while implementing if you disagree)

1. **PR identification** — tools take `repo: string` (`"owner/name"`) + `pr: number`
   (GitHub PR number) as flat scalar args, and the tool resolves internal UUIDs
   itself. **Applied.**
2. **Poll budget for `run_agent_on_pull_request`** — poll for **~60s** (interval
   ~2s, ~30 attempts); if the run hasn't reached a terminal status by then, return
   `{ run_id, status: "running", isError: false, hint: "call get_findings(run_id) again shortly" }`
   instead of blocking longer. **Applied.**
3. **Agent resolution key** — the task brief says "slug/name" but the `Agent`
   contract (`server/src/vendor/shared/contracts/knowledge.ts:182-198`) has **no
   `slug` field** — only `id` and `name`. `run_agent_on_pull_request`'s `agent`
   argument matches against `name` (case-insensitive, exact match first, then a
   "did you mean" style substring hint on miss). **Applied** — no schema change
   to the `Agent` contract to add a slug.
4. **Server change scope** — the plan adds one small additive read route
   (`GET /runs/:id/findings` in the existing `reviews` module) rather than
   changing `get_findings`'s signature to `get_findings(repo, pr, run_id)`.
   **Applied** — see "Gap 2" below for the full trade-off reasoning.

`get_blast_radius` staying a pure MCP-side stub with **zero server changes** is
a firm decision from the user, not a default — listed under Constraints, not
here.

## Context

L04 of the course ("`devdigest-mcp` server · Blast Radius", `README.md:85`) asks
for a local MCP server that lets Claude Code/Desktop drive DevDigest's existing
Fastify API (`server/`, port 3001) through 5 stdio-transport tools, without
duplicating DevDigest's business logic. The server already exposes everything
needed for 4 of the 5 tools; the 5th (blast radius) is intentionally not backed
by a real endpoint yet and must stay a documented stub.

## Modules involved

- **New package `mcp-server/`** — the MCP server itself (all new code).
- **`server/` — one small, additive change**: a new read route
  `GET /runs/:id/findings` in the existing `reviews` module (see "Technical gap
  #2" below). No other server module is touched.
- **`server/src/vendor/shared`** — consumed via a tsconfig path alias (no new
  copy), for `Finding`, `Agent`, `Repo`, `PrMeta`, `ConventionCandidate`, etc.
- Not touched: `client/`, `reviewer-core/`, `e2e/`, `server/src/modules/blast`
  (doesn't exist and must stay that way for this plan).

## Constraints

From root `CLAUDE.md`:
- Wire contracts are `snake_case` at the HTTP boundary — the MCP tool
  input/output schemas the implementer writes must mirror the existing
  `snake_case` field names from the contracts (`head_sha`, `start_line`, …), not
  invent camelCase.
- No DB migrations, no changes to `agent-runner/dist/`, no lockfile hand-edits.
- The grounding gate and injection guard are out of scope — this plan never
  touches `reviewer-core/src/grounding.ts` or `prompt.ts`.
- Secrets: MCP server talks to `http://localhost:3001` with **no auth** —
  `LocalNoAuthProvider` (`server/src/adapters/auth/local.ts:14-33`) always
  resolves the same system user/workspace locally, confirmed still true.

From `server/CLAUDE.md`:
- Module shape convention (`routes.ts` + `service.ts` + `repository.ts`) governs
  the one server addition in this plan (`server/src/modules/reviews/`).
- DB naming: `snake_case` SQL / `camelCase` Drizzle — not relevant to the MCP
  package itself (no DB access there) but relevant to the one server route.

From root `INSIGHTS.md:46-61` (contract duplication):
- `server/src/vendor/shared` and `client/src/vendor/shared` are two independent,
  git-tracked copies with no sync mechanism — a known, accepted risk. Adding a
  **third** copy in `mcp-server/` would compound this (one more place a contract
  change silently goes stale). **Decision: use a tsconfig path alias to the
  server's copy, not a third copy** — see "Contracts" below for the trade-off
  actually taken.

From `server/INSIGHTS.md` (verified still current):
- `2026-08-06`: an invalid `POST /agents`/review request fails **silently** from
  the caller's point of view if it never produces a run row — `waitForPrRuns`'s
  failure mode is a timeout, not an error (`server/test/helpers/runs.ts:17-30`).
  The equivalent risk for `run_agent_on_pull_request`: if agent/PR/repo
  resolution silently produces a bad `agentId`, the tool must fail fast with
  `isError: true` **before** calling `POST /pulls/:id/review`, not rely on
  polling to eventually notice nothing was created.
- `2026-08-02`: no precedent for `db.transaction` outside the one conventions
  case — irrelevant here since the one server addition is a single-table read
  query, no transaction needed.

From `reviewer-core/CLAUDE.md`:
- `npm run build` is `tsc --noEmit` — no `dist/`. Irrelevant to `mcp-server/`
  itself but relevant if the implementer is tempted to reuse `reviewer-core`
  types directly; not needed for these 5 tools.

## Technical gaps investigated and resolved

### Gap 1 — resolving `repo: "owner/name"` → internal repo UUID

No `GET /repos?owner=&name=` (or similar) route exists — confirmed by reading
`server/src/modules/repos/routes.ts:1-48` in full: the module only has
`POST /repos`, `GET /repos` (full list, workspace-scoped), `POST /repos/:id/refresh`,
`DELETE /repos/:id`. The `Repo` DTO returned by `GET /repos` already carries
`owner`, `name`, and `full_name` (`server/src/vendor/shared/contracts/platform.ts:151-153`
— confirmed field names).

**Resolution: no server change.** `mcp-server/` calls `GET /repos` once and does
a client-side, case-insensitive match on `full_name === "owner/name"`. This is
the least invasive option the task brief asked for — a dedicated query-param
route would be a second way to do the same lookup Diagnostics already support.
Cache the list in-process per tool call (no cross-call cache — repos rarely
change mid-session and staleness would be worse than one extra GET).

### Gap 2 — `get_findings(run_id)`: no direct route from a bare `run_id` to findings

Investigated the two candidate paths named in the task brief:
- `GET /runs/:id/trace` (`reviews/routes.ts:145-150`) returns `RunTrace`
  (`server/src/vendor/shared/contracts/trace.ts:91-108`) — its `config.pr` is
  the **PR number** (`z.number().int().nullish()`), not a pull UUID, and it has
  no `pull_id`/`repo_id` field at all. Dead end for resolving to
  `GET /pulls/:id/reviews`.
- `agent_runs` (`server/src/db/schema/runs.ts:8-36`) **does** have `prId`
  (`pr_id`), but there is no route that exposes a single `agent_runs` row by id
  outside of `GET /pulls/:id/runs` (which requires the pull UUID up front —
  circular for a tool that only has `run_id`).

**The actual shortcut**: `reviews` (`server/src/db/schema/reviews.ts:9-26`) has
its own `runId` column (`run_id`), populated directly at review-insert time
(`server/src/modules/reviews/run-executor.ts:315-320`, `kind: 'review'`) — i.e.
a review row is *already* keyed by both `pr_id` and `run_id` independently, no
join through `agent_runs`/`pull_id` needed at all. `reviewRepo.reviewsForPull`
(`server/src/modules/reviews/repository/review.repo.ts:58-74`) shows the exact
query shape to copy, filtered by `run_id` instead of `pr_id`.

**Decision: minimal server addition**, not a tool-signature change. Add to the
existing `reviews` module (already owns `reviews`/`findings`/`agent_runs`):
- `review.repo.ts`: `getReviewByRunId(db, runId): Promise<{ review: ReviewRow; findings: FindingRow[] } | undefined>` —
  `SELECT * FROM reviews WHERE run_id = :runId LIMIT 1`, then findings by
  `review_id`, mirroring `reviewsForPull`'s pattern exactly.
- `ReviewRepository`: thin passthrough method `getReviewByRunId(runId)`.
- `ReviewService`: `async findingsForRun(runId: string): Promise<ReviewDto | undefined>` —
  reuses the existing `reviewToDto`/`findingRowToDto` helpers (`helpers.ts:34-74`),
  no new DTO type.
- `routes.ts`: `GET /runs/:id/findings` → 404 via `NotFoundError` if no review
  row has that `run_id` (covers "run still in flight, no review persisted yet"
  and "run_id doesn't exist" with the same 404 — the MCP tool distinguishes them
  by also checking run status, see tool design below); else returns the
  `ReviewDto` (== `ReviewRecord` shape, `review-api.ts:23-38`).

Chosen over the alternative ("change `get_findings`'s signature to
`get_findings(repo, pr, run_id)`") because: (a) it keeps the flat, single-purpose
argument the user's design principle #2 asks for — `get_findings(run_id)` reads
naturally on its own, without forcing the caller to already have repo/pr in
hand; (b) it's a **strictly additive**, single-query, workspace-unscoped-by-design
read (acceptable because this is a local, single-workspace, no-auth deployment —
`LocalNoAuthProvider` — so there is exactly one workspace to leak across, i.e.
none); (c) it reuses 100% existing DTO/helper code, no new contract type.

Trade-off accepted: this is the **one place** this plan touches `server/src/`
at all. It is additive-only (new route + 2 new methods), does not change any
existing route's behavior or shape, and needs no migration (no schema change —
`reviews.run_id` already exists and is indexable if ever needed, though at
today's local-dev data volumes an unindexed scan is fine; the implementer
should NOT add an index as part of this task — out of scope, flag as a
possible future `db:generate` if it ever matters).

### Gap 3 (informational — not a gap, confirms `get_conventions` needs nothing)

`GET /repos/:repoId/conventions` (`conventions/routes.ts:31-34`,
`ConventionsService.list`, `conventions/service.ts:34-37`) is a plain read of
already-extracted candidates — no server change needed. Confirmed
`ConventionCandidate` shape at `server/src/vendor/shared/contracts/knowledge.ts:147-158`.

## Contracts strategy (tsconfig path alias vs a third copy)

**Decision: alias, not a copy.** `mcp-server/tsconfig.json` adds:
```json
"paths": {
  "@devdigest/shared": ["../server/src/vendor/shared/index.ts"],
  "@devdigest/shared/*": ["../server/src/vendor/shared/*"]
}
```
mirroring `server/tsconfig.json:21-26` exactly (server aliases the same path to
itself; `mcp-server/` just points one level up). This is TS-source-only reuse —
"cross-package code is shared through tsconfig path aliases to TS source, never
built output" (root `CLAUDE.md`, Repo shape section) — consistent with existing
practice, and it is explicitly **not** a third physical copy, so it does not
add to the `INSIGHTS.md:46-61` duplication problem; it removes one instance of
what would otherwise be a *fourth*. The trade-off accepted: `mcp-server/`
becomes coupled to `server/`'s repo-relative layout (a sibling checkout
assumption already true for `client/` and the aliasing server itself), and if
`server/src/vendor/shared` is ever moved, `mcp-server/tsconfig.json` breaks
silently until `tsc` is run — same failure mode `client/` already lives with.
No new runtime dependency is added; this is compile-time only, and at runtime
`mcp-server/` only needs the **shapes** for building/parsing its own request
and response bodies (it talks to the API over plain `fetch`, so no server code
executes inside `mcp-server/`'s process — only Zod schema objects are imported).

## Skills the implementer will use

- **`onion-architecture`** — the implementer will invoke this before adding
  `GET /runs/:id/findings`, since it touches `server/src/modules/reviews/**`
  (routes → service → repository layering, no adapter/DB logic leaking into
  routes.ts).
- **`zod`** — for defining the 5 tools' input/output Zod schemas idiomatically
  (the MCP SDK's `server.tool()` takes a Zod raw shape for inputSchema).
- **`typescript-expert`** — for the tsconfig path-alias setup in a `noEmit`,
  `tsx`-run package (mirroring `e2e/tsconfig.json`'s `Bundler` resolution) and
  for typing the thin HTTP client against the aliased `@devdigest/shared` types.
- **`fastify-best-practices`** — only for the one server-side route addition
  (`GET /runs/:id/findings`), to keep it idiomatic with the rest of `reviews/routes.ts`
  (zod `params` schema via `IdParams`, `NotFoundError` for the 404 case).
- **`engineering-insights`** — invoke at the end of the implementation session
  to record anything non-obvious hit while building this (e.g. any MCP SDK
  quirk with stdio transport + Zod schemas, or anything about the polling
  behavior against real run timing).
- Explicitly **not** `security` or any review skill — architecture/security
  review is out of scope for the implementer (see "Out of scope").

## `mcp-server/` package layout

```
mcp-server/
  package.json            # npm (not pnpm), private, type: module
  tsconfig.json            # noEmit, Bundler resolution, path alias to shared
  README.md                 # how to point Claude Code/Desktop at this server (stdio cmd)
  src/
    index.ts                # entry point: builds the McpServer, registers 5 tools, connects StdioServerTransport
    http-client.ts          # thin fetch wrapper: baseUrl http://localhost:3001 (env override DEVDIGEST_API_URL), JSON in/out, typed errors
    errors.ts               # ToolError class + toToolErrorResult() -> {isError:true, content:[{type:'text', text}]}
    resolvers.ts            # resolveRepo(repoFullName), resolvePull(repoId, prNumber), resolveAgent(agentName)
    polling.ts               # pollRunUntilTerminal(runId, {timeoutMs, intervalMs}) using GET /pulls/:id/runs
    tools/
      list-agents.ts
      run-agent-on-pull-request.ts
      get-findings.ts
      get-conventions.ts
      get-blast-radius.ts
```

`package.json` (npm, thin, modeled on `e2e/package.json`):
- `scripts`: `{"start": "tsx src/index.ts", "typecheck": "tsc --noEmit -p tsconfig.json"}`.
- `devDependencies`: `@types/node`, `tsx`, `typescript` (same versions as `e2e/package.json:12-16`).
- `dependencies`: `@modelcontextprotocol/sdk`, `zod` (whichever major the SDK
  peer-depends on — implementer must check the SDK's package.json for the
  exact `zod` version it expects to avoid a schema-shape mismatch).

`tsconfig.json` (modeled on `e2e/tsconfig.json:1-15`, with the shared alias
added):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "paths": {
      "@devdigest/shared": ["../server/src/vendor/shared/index.ts"],
      "@devdigest/shared/*": ["../server/src/vendor/shared/*"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

### HTTP client (`http-client.ts`)

One `class DevDigestApiClient` (or plain functions) wrapping `fetch` against
`process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001'`. No auth headers
(confirmed no-auth locally). Throws a typed `ApiError { status, body }` on
non-2xx so tool handlers can map it to a tool-specific `isError: true` message
rather than leaking a raw stack/HTTP body to the MCP client.

### Error mapping (`errors.ts`)

Every tool handler catches `ApiError`/`ResolutionError` and returns
`{ isError: true, content: [{ type: 'text', text: <message ending in "call X to see/verify Y"> }] }`
per the "error leads forward" design principle — never a raw 404 JSON dump.
Malformed input (wrong type/missing required field) is left to the MCP SDK's
own Zod-schema validation — a **protocol error**, not something the handler
code catches, per the best-practice note about Protocol vs Tool Execution
Errors.

## Tool designs

All 5 tools use flat scalar args, `snake_case` tool names, and annotations per
the task brief. All output schemas strip persisted-only/internal fields
(`accepted_at`, `dismissed_at`, `review_id`, raw `RunTrace`) per design
principle #3.

### 1. `list_agents`
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`.
- Input: `z.object({})` (no args).
- Calls `GET /agents`.
- Output: `{ agents: { id: string; name: string; description: string; provider: string; model: string; enabled: boolean; strategy: string }[] }`
  — a filtered subset of `Agent` (`knowledge.ts:182-198`); drops
  `system_prompt`, `output_schema`, `version`, `ci_fail_on`, `repo_intel` as
  internal/verbose fields not needed for tool selection.
- **Final description (use verbatim in implementation — do not paraphrase):**
  `"List all configured review agents in this workspace (id, name, provider,
  model, and whether each is enabled). Read-only, no arguments. Call this
  first to discover valid agent names before calling run_agent_on_pull_request
  — its agent argument must match one of the names returned here."`

### 2. `run_agent_on_pull_request`
- Annotations: `{ readOnlyHint: false, idempotentHint: false }` (each call
  starts a new run).
- Input: `z.object({ repo: z.string(), pr: z.number().int(), agent: z.string() })`.
- Steps (all via `resolvers.ts` + `polling.ts`):
  1. `resolveRepo(repo)` → repo UUID via `GET /repos` + `full_name` match
     (Gap 1 resolution). Not found → `isError: true`, "repo 'x/y' not found
     among connected repos; call list via GET /repos equivalent — actually
     point at nothing to call since there's no repos-listing tool in this set;
     message should instead say to double check the repo was added in the
     DevDigest UI first" (implementer: phrase precisely, no tool to redirect
     to here since `list_agents`/`get_conventions`/etc. don't cover repos —
     this is an intentional limitation of the 5-tool set, note it in the
     tool's description too).
  2. `resolvePull(repoId, pr)` → pull UUID via `GET /repos/:id/pulls`, match
     `number === pr`. Not found → `isError: true`, "PR #N not found in repo
     x/y — it may not be imported yet".
  3. `resolveAgent(agent)` → agent id via `GET /agents`, case-insensitive
     `name` match (see Open Question 3). Not found → `isError: true`, "agent
     'foo' not found, call list_agents to see available agents" (verbatim
     per the task's own example).
  4. `POST /pulls/:{pullId}/review` with `{ agentId }`. Response is
     `ReviewRunResponse` (`review-api.ts:52-57`); take `runs[0].run_id`
     (exactly one run since exactly one agent was targeted).
  5. `pollRunUntilTerminal(pullId, runId, { timeoutMs: 60_000, intervalMs: 2_000 })`
     — polls `GET /pulls/:id/runs`, finds the row with matching `run_id`,
     checks `status` (`RunSummary.status`, `trace.ts:120`: `running | done |
     failed | cancelled`) until it's not `'running'`, or the budget elapses.
  6. On terminal `'done'`: call the **new** `GET /runs/:id/findings` (Gap 2
     resolution) and return `{ verdict, score, findings: [{severity, category,
     file, start_line, end_line, title, rationale, suggestion, confidence}] }`
     — dropping `id`, `review_id`, `accepted_at`, `dismissed_at`, `kind`,
     `trifecta_components`, `evidence` (verbose/internal) per design
     principle #3. `kind==='finding'` findings only unless caller cares about
     others — implementer's call, default to returning all kinds but flagging
     `kind` in the output when it's not `'finding'`.
  7. On terminal `'failed'`/`'cancelled'`: `isError: true` with the run's
     `error` field (from the same `GET /pulls/:id/runs` row) and a hint to
     call `get_findings` won't help since there's nothing to fetch — say so.
  8. On budget exhausted while still `'running'`: NOT an error —
     `{ run_id, status: 'running', hint: 'call get_findings(run_id) again
     shortly' }` (Open Question 2's assumption).
- **Final description (use verbatim in implementation — do not paraphrase):**
  `"Run a named review agent on a pull request and wait for the result.
  Arguments: repo ('owner/name'), pr (PR number), agent (agent name, see
  list_agents). This starts a new review run, polls for up to ~60 seconds, and
  returns the final { verdict, score, findings } once the run completes. If
  the run is still in progress after ~60s, returns { run_id, status: 'running' }
  instead — call get_findings(run_id) again after a short wait to retrieve the
  result."`

### 3. `get_findings`
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`.
- Input: `z.object({ run_id: z.string() })`.
- Calls `GET /runs/:id/findings` (Gap 2's new route).
- 404 → `isError: true`: "run '<id>' has no findings yet — it may still be
  running (call run_agent_on_pull_request and wait) or the run_id doesn't
  exist."
- Output (same shape as step 6 above): `{ verdict, score, findings: [...] }`.
- Pagination: add `limit?: number` (default e.g. 50, hard cap e.g. 200) on the
  `findings` array — server-side slice in the tool handler (the new route
  itself returns everything; the MCP layer truncates and reports
  `truncated: boolean` + `total: number` in the output so a caller knows more
  exist). No cursor needed at this data volume (a single review's findings
  list, not a paginated collection) — a flat `limit` is sufficient per the
  task's own pagination note.
- **Final description (use verbatim in implementation — do not paraphrase):**
  `"Fetch findings for an already-completed agent run,
  by run_id (as returned by run_agent_on_pull_request). Returns verdict, score,
  and a findings array (severity, category, file, line range, title,
  rationale) — capped at limit (default 50, max 200), with total/truncated so
  you know if more exist. If the run has no findings yet, it may still be
  running — call run_agent_on_pull_request and wait, or re-check shortly."`

### 4. `get_conventions`
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`.
- Input: `z.object({ repo: z.string(), limit: z.number().int().positive().max(200).optional() })`.
- `resolveRepo(repo)` (reuse from tool 2) → `GET /repos/:id/conventions`.
- Output: `{ conventions: { id, rule, category, evidence_path, evidence_line,
  evidence_snippet, confidence, status }[], total: number, truncated: boolean }`
  — this is already the full `ConventionCandidate` shape (`knowledge.ts:147-158`),
  nothing internal to strip; only the `limit`/`truncated` wrapper is added.
- Does **not** call `POST /repos/:repoId/conventions/extract` — read-only, per
  the task's explicit boundary.
- Not-found repo → same message as tool 2's repo-resolution failure.
- **Final description (use verbatim in implementation — do not paraphrase):**
  `"Fetch already-extracted coding conventions for a
  repo ('owner/name') — naming, error-handling, testing rules the team
  actually follows, each with file/line evidence and a confidence score.
  Read-only: does not trigger new extraction, only returns existing
  candidates. Optional limit caps the list (default 50, max 200)."`

### 5. `get_blast_radius`
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`.
- Input: `z.object({ repo: z.string(), pr: z.number().int() })`.
- **No HTTP call at all** — pure stub. Still resolves `repo`/`pr` via the same
  resolvers first (so a caller gets a real "repo/PR not found" error instead
  of a blanket "not implemented" for bad input — this matters because the
  stub should not mask an actual mistake).
- On successful resolution: returns
  `{ isError: true, content: [{ type: 'text', text: "Blast Radius is not implemented yet — it's a planned feature (see README.md's course roadmap, L04). repo_intel already has getBlastRadius() as a facade method (server/src/modules/repo-intel/types.ts:147), but no /blast route or module exists yet. This tool will start working once that lands; no action to retry here." }] }`.
- Explicitly documented in the tool's own `description` field as "NOT YET
  IMPLEMENTED — always returns a stub error" so a client-side model doesn't
  need to call it once to discover that.
- **Final description (use verbatim in implementation — do not paraphrase):**
  `"NOT YET IMPLEMENTED — this tool always returns an
  error. Planned to analyze which files/callers/endpoints are impacted by a
  PR's changes (blast radius), but the feature isn't built yet. repo and pr
  are still validated first, so a bad repo/PR number gets a specific
  'not found' error, not this generic one. Do not call this expecting a real
  result yet — use get_findings or get_conventions for currently available
  analysis."`

## Deferred loading

Not in scope for `mcp-server/` itself — `defer_loading` is an Anthropic-API/
client-side MCP configuration knob, not something a server implements. One
sentence noting this suffices in the implementer's own summary; no code
change follows from it.

## Server-side change: exact files to touch

1. `server/src/modules/reviews/repository/review.repo.ts` — add
   `getReviewByRunId(db, runId)` next to `reviewsForPull` (same pattern, filter
   by `t.reviews.runId` instead of `t.reviews.prId`, `LIMIT 1` via `.limit(1)`
   or just take `rows[0]`).
2. `server/src/modules/reviews/repository.ts` — add the passthrough method on
   `ReviewRepository`.
3. `server/src/modules/reviews/service.ts` — add
   `async findingsForRun(runId: string): Promise<ReviewDto | undefined>` using
   the existing `reviewToDto` (needs the agent name lookup exactly like
   `reviewsForPull` already does — reuse that pattern, don't skip the agent
   name resolution).
4. `server/src/modules/reviews/routes.ts` — add
   `app.get('/runs/:id/findings', { schema: { params: IdParams } }, async (req) => { ... throw NotFoundError ... })`
   right next to the existing `GET /runs/:id/trace` route, same style.
5. Add a unit test `server/test/reviews-findings-by-run.test.ts` (hermetic,
   no `.it.test.ts` suffix needed if it can run against a stubbed
   `ReviewRepository`/mock DB the way `conventions-file-guard.test.ts` does —
   OR an integration test if it's simpler to just exercise the real route with
   testcontainers; implementer's call, follow whichever existing precedent in
   `server/test/reviews*.test.ts` is closest). Must cover: (a) found run → 200
   with findings, (b) unknown run_id → 404.

## Ordered steps for the implementer

1. Read `server/src/modules/reviews/repository/review.repo.ts`,
   `repository.ts`, `service.ts`, `routes.ts`, `helpers.ts` in full (already
   summarized above but re-verify line numbers before editing — the planner's
   citations may have shifted).
2. Invoke `onion-architecture` skill, then implement the `GET /runs/:id/findings`
   addition (files 1-4 above), smallest diff possible — no refactor of
   surrounding code.
3. Write the server-side test (file 5) and run
   `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (or the
   `.it.test` command if an integration test was chosen) until green.
4. Run `cd server && pnpm typecheck` to confirm the new route/service/repo
   method type-check cleanly against the existing `Container`/`ReviewRow` types.
5. Scaffold `mcp-server/` (`package.json`, `tsconfig.json`, `README.md`) per
   the layout above; `npm install` inside `mcp-server/`.
6. Implement `src/http-client.ts` and `src/errors.ts` first (no tools depend on
   anything else).
7. Implement `src/resolvers.ts` (`resolveRepo`, `resolvePull`, `resolveAgent`)
   and `src/polling.ts` (`pollRunUntilTerminal`) — these are shared by 3+ tools.
8. Implement the 5 tool modules under `src/tools/`, in this order: `list-agents`
   (simplest, validates the SDK wiring end to end) → `get-conventions` →
   `get-findings` → `get-blast-radius` (stub, no HTTP) → `run-agent-on-pull-request`
   (composes everything else, do last).
9. Implement `src/index.ts`: construct `McpServer`, register all 5 tools with
   their Zod schemas + annotations + descriptions, connect
   `StdioServerTransport`.
10. Manual smoke test: run `mcp-server` against a live local API
    (`./scripts/dev.sh` running) using the MCP SDK's own test client, or by
    wiring it into Claude Code's local MCP config and calling each tool once
    against real seeded data (`acme/payments-api`, PR #482, per
    `server/README.md:110`).
11. Write `mcp-server/README.md`: how to add this server to Claude Code/Desktop
    config (stdio command `node`/`tsx src/index.ts` or `npm start`), and the
    `DEVDIGEST_API_URL` env override.
12. Invoke `engineering-insights` at the end if anything non-obvious was hit
    (SDK version quirks, actual observed run timing vs the 60s budget, etc.).

## Test plan

- **Server** (for the one route addition): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  must stay green with the new test added; `pnpm typecheck` clean. If an
  integration test is chosen instead: `pnpm exec vitest run .it.test` (needs
  Docker; self-skips without it, per `TESTING.md`).
- **`mcp-server/`** (new suite, no existing CI workflow — implementer should
  decide whether to add one, out of scope for this plan to mandate, but do add
  local test coverage regardless):
  - Unit tests for `resolvers.ts` and `polling.ts` against a **mocked**
    `http-client` (no real network) — assert: repo match by `full_name`
    (case-insensitive), pull match by `number`, agent match by `name`
    (case-insensitive), and each "not found" path returns the exact error
    shape the tool handlers expect.
  - Unit tests for each tool handler with the http-client mocked at the fetch
    boundary (module-level mock, mirroring `server/src/adapters/mocks.ts`'s
    spirit of "mock the outside world" from `TESTING.md`) — one happy path +
    one not-found/error path per tool, plus `run_agent_on_pull_request`'s
    running/timeout branch and failed/cancelled branch.
  - Runner: since this is an npm package with no test script decided yet by
    the user, add `vitest` as a devDependency (consistent with every other
    package's test runner in this repo) and a `"test": "vitest run"` script;
    this is the implementer's one new tooling choice — flag it in the PR
    description since it's not dictated verbatim by e2e's shape (e2e has no
    unit tests of its own, it's browser-flow only, so there's no existing
    "npm package + vitest" precedent to copy verbatim — `reviewer-core` is the
    closest npm+vitest precedent to follow for `package.json` script naming).
  - Optional (recommended, not required): one hermetic "integration" script
    that boots the real API via `./scripts/dev.sh` conventions and drives the
    live MCP tools end to end against seeded data — model this loosely on
    `e2e/README.md`'s hermetic-runner precondition, but this is a stretch goal,
    not a blocker for calling the task done.
- **Full pass bar**: server unit suite green + typecheck clean + all new
  `mcp-server/` unit tests green + manual smoke test (step 10) observed to
  return real data for at least `list_agents`, `get_conventions`, and one full
  `run_agent_on_pull_request` → `get_findings` round trip against the seeded
  demo repo/PR.

## Out of scope

- Architecture review and security review of this plan and its implementation
  are **not** part of this plan or the implementer's job — they belong to
  separate review agents (the `onion-architecture` and `security` skills are
  named above only as implementation aids for staying consistent with existing
  conventions, not as a substitute for a dedicated review pass).
- Implementing real Blast Radius logic (`server/src/modules/blast/`) — firmly
  out of scope per the user's decision; `get_blast_radius` stays a stub.
- `POST /repos/:repoId/conventions/extract` — `get_conventions` never triggers
  extraction, only reads existing candidates.
- Any HTTP/SSE MCP transport — stdio only.
- CI workflow wiring for a new `mcp-server.yml` — not requested; local test
  commands are enough for this task.
