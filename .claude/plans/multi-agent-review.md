# Development Plan — Multi-Agent Review (SPEC-07)

**Execution mode:** multi-agent

**Source spec:** `docs/specs/SPEC-07-multi-agent-review.md` (Status: approved).
Both prior Open questions are resolved by the user (see spec "Open questions"):
(1) starting a new group run while an older one is still `running` is allowed
without a confirm dialog; (2) no retroactive `multi_agent_run_id` backfill for
pre-existing `all:true` runs.

## Execution constraints (binding, from the user — quoted verbatim in intent)

- **3–5 `implementer` agents total**, dispatched one group at a time, **in the
  dependency order given below** (not arbitrarily parallel) — later groups
  read contracts/endpoints/components the earlier groups produce. This plan
  uses **4** implementer agents (within the 3–5 bound); see "Ordered steps"
  for the exact task-group → agent mapping.
- **No `implementer` in this workflow writes new test files.** Each
  implementer may run *already-existing* tests for the files it touches
  (`pnpm test` in the affected package) to self-check, but must not add new
  `*.test.ts`/`*.test.tsx`/`*.it.test.ts` files. New tests are produced only by
  `plan-verifier`, which checks the finished code against this plan's
  Acceptance Criteria / Test plan below.
- **Review order after implementation:** `architecture-reviewer` → then
  `plan-verifier` (in that order, not `test-writer`).
- **Bounded fix-loop:** if `architecture-reviewer`/`plan-verifier` findings
  require a fix, feed them back to `implementer` — but the fix-loop may spend
  **at most 2 subagents total** across the whole loop (not 2 rounds; 2
  subagent invocations, period, however they're split across findings). This
  caps the automated retry budget for whoever runs this plan (`Runplan`/
  `sdd-implement`) — enforcing it is that runner's job, not this document's,
  but the number is fixed here so it isn't re-litigated at run time.
- The plan is expected to be handed back to the user for a re-read before any
  execution starts — this document alone doesn't trigger a run.

## Context

Today `POST /pulls/:id/review` already runs one agent (`{agentId}`) or all
enabled agents (`{all:true}`), but (a) there is no way to pick an explicit
*subset* of agents, (b) queued agents run **sequentially** — one full LLM call
finishes before the next starts (`server/src/modules/reviews/run-executor.ts:160-197`,
verified: a plain `for (...) { await this.runOneAgent(...) }`) despite the
lab/mockup's "N agents in parallel, ~7s total" framing, and (c) there is no
screen showing several agents' results together, no findings-clustering
heuristic (`grep -rn "cluster|similarity|dedup" server/src reviewer-core/src`
found nothing), and no "where agents disagree" view. This plan adds all of the
above as a new `multi-agent` PR tab, reusing existing pieces (`RunTraceDrawer`,
`FindingCard`, `CircularScore`, `RunCostBadge`, `usePrRuns`'s 4s poll,
`GET /agents/:id/stats`) wherever the spec's Reconciliation section confirms
they already work — new code is added only where the spec proved (via
`file:line`) nothing reusable exists.

## Modules involved

- **server** (`server/src/modules/reviews/**`, `server/src/modules/agents/**`
  read-only, `server/src/db/schema/runs.ts`, new migration) — contracts, the
  new `agentIds` targeting branch, concurrent execution, `multi_agent_runs`
  linkage, the findings-clustering pure function, and the run-group-scoped
  read endpoint.
- **client** (`client/src/app/repos/[repoId]/pulls/[number]/**`,
  `client/src/lib/hooks/reviews.ts`) — the new Multi-Agent Review tab, its
  Configure-run/Columns/Tabs/Disagree sub-components, and the client-side
  `groupRuns`-style grouping helper.
- **shared contracts** (`server/src/vendor/shared/contracts/**` AND
  `client/src/vendor/shared/contracts/**` — two physically separate,
  git-tracked copies, no symlink/sync script; root `INSIGHTS.md` 2026-07-31)
  — `RunRequest`, `ReviewRunResponse`, `RunSummary` all get new fields, in
  BOTH copies, in the same task.
- **Out of bounds for this plan** — `ci/`, `agent-runner/` (owned by the
  separate SPEC-08, merges after this plan per the lab's Part 2), and
  `reviewer-core/` (the spec explicitly does not touch the single-agent
  pipeline itself — this plan only changes how many pipeline instances run
  concurrently and how the server groups/serves their output).

## Constraints

- **Wire contracts are snake_case** (`root CLAUDE.md`) — `agent_ids` is NOT a
  field name the spec uses; the spec's own AC-10 spells it `agentIds` inside
  the JSON body (camelCase field name, snake_case is for nouns like
  `run_group_id`/`multi_agent_run_id` — follow the spec's exact field names
  literally, they are already correct wire-contract-cased as given).
- **Dual-copy contracts gotcha** (root `INSIGHTS.md` 2026-07-31): any of the
  three contract edits (T1 below) must land in BOTH
  `server/src/vendor/shared/contracts/*.ts` and
  `client/src/vendor/shared/contracts/*.ts` in the same task — verified here
  that `platform.ts`/`review-api.ts`/`trace.ts` are currently byte-identical
  (aside from two comment-only lines in `trace.ts`) between the two copies, so
  there is no pre-existing drift to reconcile first.
- **Migrations are generated, never hand-written** (root `CLAUDE.md`,
  `server/CLAUDE.md`) — the new `agent_runs.multi_agent_run_id` column comes
  from `pnpm db:generate` after editing `db/schema.ts`, per the
  gotcha-avoidance note below (`pnpm exec`/`pnpm run` gets stuck on
  `ERR_PNPM_IGNORED_BUILDS` in a non-interactive shell — call
  `node node_modules/drizzle-kit/bin.cjs generate` directly; root `INSIGHTS.md`
  2026-07-28).
- **`multi_agent_runs` table already exists, empty** (`server/src/db/schema/runs.ts:46-55`)
  — this plan does NOT create that table, only the new FK column on
  `agent_runs` plus the code that populates both.
- **`reviews.run_id` is a bare `uuid` column, not a real FK** to `agent_runs.id`
  (`server/INSIGHTS.md` 2026-08-20) — nothing in this plan needs to change
  that, but T14's new read path (reviews scoped to a set of `run_ids`) must
  not assume DB-level uniqueness it doesn't have; rely on the existing
  `reviewsForPull` + in-memory filter by `run_id`, the same pattern
  `reviewsForPull` already uses.
- **`invalid_run_request` (400) contract must survive AC-10** — today
  `resolveTargets` throws it when neither `agentId` nor `all` is set
  (`service.ts:58`); after this plan exactly one of `agentId`/`all`/`agentIds`
  non-empty must be required, same error/code/status for the "none provided"
  case.
- **Per-job try/catch isolation must survive the sequential→concurrent
  rewrite** (T5) — `run-executor.ts`'s `failAll()` (pre-work failure, e.g. diff
  load) and per-agent catch block (`run-executor.ts:188-196`) must keep
  behaving identically; only the `for`-loop's `await`-per-iteration is
  removed.
- **onion/DI**: `ReviewRunExecutor`/`ReviewService` keep resolving
  dependencies via the `Container` (`server/src/platform/container.ts`), no
  new concrete adapter import in a route file, no service importing a
  concrete adapter class directly — this plan adds no new external
  integration, so this mostly means: don't let `findings-cluster.ts` (T6)
  reach into `db`/`repository` — it must be a pure function taking arrays in,
  arrays out (AC-19 requires it be usable read-only, no DB).
- **Module shape**: server changes stay inside
  `modules/reviews/{routes,service,run-executor,repository}.ts` plus one new
  pure-function file `modules/reviews/findings-cluster.ts` — no new module
  directory needed.
- **Client feature-folder shape** (`client/CLAUDE.md`): every new UI piece is
  a `_components/<Name>/` folder colocated under
  `client/src/app/repos/[repoId]/pulls/[number]/_components/`, each with
  `<Name>.tsx` + `index.ts` (+ `styles.ts`/`helpers.ts`/`constants.ts` as
  needed) — matching the existing `RunHistory/`, `FindingsPanel/`,
  `RunTraceDrawer/` siblings in the same directory.
- **react-ui-architecture "promote on second user"** (client `INSIGHTS.md`
  2026-08-19, `EvalCaseModal`/`METRIC_COLOR` precedent) — none of this plan's
  new client pieces (`ConfigureRunScreen`, `ColumnsView`, `TabsDetailView`,
  `AgentsDisagreeSection`, `MultiAgentReviewTab`) currently has a second
  consumer outside the PR-detail feature tree, so they stay feature-local
  under `_components/`, not promoted to `client/src/components/`. The one
  exception: the new grouping helper (T8) should be modeled after
  `client/src/lib/eval-runs.ts`'s `groupRuns`/`RunGroup` pattern — put it in
  `client/src/lib/` (e.g. `client/src/lib/multi-agent-runs.ts`) from the
  start, mirroring that file's already-promoted shape, rather than nesting it
  inside a `_components/` folder and having to promote it later.
- **Spec citation correction — do not trust literally.** The spec's T8 cites
  `EvalsTab/EvalsTab.tsx:83` for the "compute on read" `groupRuns` precedent.
  That file no longer exists under that name: it was promoted/renamed to
  `client/src/components/eval-owner-tab/EvalOwnerTab.tsx` (client
  `INSIGHTS.md` 2026-08-19 decision entry), and `groupRuns` itself lives in
  `client/src/lib/eval-runs.ts` (imported by `EvalOwnerTab.tsx:19`, called at
  `EvalOwnerTab.tsx:87`), not inlined in the tab component at all. Model T8's
  new helper after `client/src/lib/eval-runs.ts`'s actual shape (`RunGroup`
  interface + a pure `groupRuns(rows)` function returning newest-group-first),
  not after the stale line-number citation.
- **`FindingCard` already excludes Learn/Reply-to-author** (AC-29) —
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:131-161`
  renders exactly Accept/Dismiss/"Turn into eval case" and nothing else;
  reusing this component as-is in `TabsDetailView` (T12) satisfies AC-29 with
  zero extra code — do not add a fourth button "just in case".
- **`RunReviewDropdown` already lists ALL agents, not just enabled ones**
  (`RunReviewDropdown.tsx:54-61`, `all.map(...)`) — `ConfigureRunScreen` (T10)
  must follow the same "show every agent, default-checked = `agent.enabled`"
  rule (AC-5), consistent with this existing picker, not a new "enabled only"
  filter.
- **`usePrRuns` already polls every 4s while any run is `status:'running'`**
  (`client/src/lib/hooks/reviews.ts:42-50`) — `ColumnsView` (T11, AC-27) must
  reuse this hook's data as-is, no second poll loop, no new SSE subscription
  outside `RunTraceDrawer`.
- **Design decision this plan makes, since the spec explicitly left it open**
  (T14): the spec says "a new endpoint or an extension of the existing
  `GET /pulls/:id/reviews`" for the run-group-scoped reviews+clusters read.
  Because the existing route's response type (`ReviewRecord[]` — a bare
  array, consumed unscoped by `usePrReviews`/`page.tsx`) cannot silently grow
  a second shape (`{reviews, clusters}`) without breaking that existing
  consumer's type, this plan adds a **new, additional** route instead of
  overloading the existing one — see T14 in "Ordered steps" for the exact
  shape. This is a plan-level call resolving the spec's own explicitly-left
  ambiguity, not a scope change; flag it back to the user if they'd rather
  overload the existing route with a query-param branch.
- **Security (NFR section of the spec, already OWASP-reviewed)** — `.max(20)`
  on `agentIds` (AC-10), workspace-scoped resolution before any DB write
  (AC-11/AC-12), no new `dangerouslySetInnerHTML` (findings render through the
  existing `<Markdown>`/plain-JSX-text path only), structured logs on
  concurrent execution carry only `runId`/`agentId`/`multiAgentRunId`/
  duration/tokens/cost/findings counts, never prose finding/prompt content —
  this plan changes nothing about these controls; `architecture-reviewer`
  should confirm they weren't dropped, not re-derive them.

## Skills the implementer will use

- **`onion-architecture`** — every server task (T1-T7, T14) touches
  `server/src/modules/reviews/**`/`server/src/db/schema/runs.ts`; the new
  `findings-cluster.ts` (T6) must stay a pure function with zero DB/adapter
  imports, and `ReviewRunExecutor`/`ReviewService` must keep resolving
  everything through `Container`, never a concrete adapter class.
- **`drizzle-orm-patterns`** — T2's schema change
  (`agent_runs.multi_agent_run_id`, nullable FK with
  `onDelete: 'set null'`) and the generated migration.
- **`fastify-best-practices`** — T3/T4/T7/T14's route/schema changes in
  `server/src/modules/reviews/routes.ts` (zod body/query schemas, rate limit
  config already present on `POST /pulls/:id/review` and must stay
  untouched).
- **`zod`** — T1's three contract edits (`RunRequest.agentIds`,
  `ReviewRunResponse.run_group_id`, `RunSummary.multi_agent_run_id`) plus
  T14's new query/response schema.
- **`react-ui-architecture`** — every new client `_components/` folder (T9-T13)
  must follow the colocated feature-folder shape and the "promote on second
  user" rule (see Constraints above — nothing here promotes yet, except T8's
  helper which is modeled after an already-promoted file from the start).
- **`react-best-practices`** — T9-T13's component/hook design (state in
  `?view=columns|tabs` query param per AC-25, not local-only state that loses
  the view on navigation; `usePrRuns`/`usePrReviews` reuse, not new fetch
  loops).
- **`security`** — a final self-check pass on T3/T4 (AC-11/AC-12: 404 before
  any write) and on T11-T13 (nothing routes LLM-generated text through raw
  HTML) before calling any group's work done — the spec's NFR section has
  already done the OWASP analysis; the implementer's job is to not regress it,
  not redo it.
- **Explicitly NOT `test-writer`-adjacent skills for new test authorship** —
  per the binding execution constraint above, no implementer group writes new
  test files. An implementer MAY run existing suites
  (`pnpm exec vitest run --exclude '**/*.it.test.ts'` in `server/`, `pnpm test`
  in `client/`) to sanity-check its own change doesn't break something
  pre-existing, but must not add `*.test.ts`/`*.test.tsx`/`*.it.test.ts` files.

## Ordered steps

Four implementer groups, run in this order (each depends on the previous
group's output — see per-group "Depends on" line). Task numbers (`T1`-`T16`)
are the spec's own checklist numbering, reused here for traceability.

### Implementer 1 — Contracts + DB (T1, T2)

*Depends on: nothing (first group).*

1. **T1 — shared contracts**, edited identically in BOTH
   `server/src/vendor/shared/contracts/{platform,review-api,trace}.ts` and
   `client/src/vendor/shared/contracts/{platform,review-api,trace}.ts`:
   - `RunRequest` (`platform.ts`): add
     `agentIds: z.array(z.string()).min(1).max(20).optional()` alongside the
     existing `agentId`/`all`.
   - `ReviewRunResponse` (`review-api.ts`): add
     `run_group_id: z.string().nullable()`.
   - `RunSummary` (`trace.ts`): add
     `multi_agent_run_id: z.string().nullable()`.
2. **T2 — DB migration**: in `server/src/db/schema/runs.ts`, add
   `multiAgentRunId: uuid('multi_agent_run_id').references(() =>
   multiAgentRuns.id, { onDelete: 'set null' })` to the `agentRuns` table
   definition (nullable — AC-15). Generate the migration via
   `node node_modules/drizzle-kit/bin.cjs generate` from `server/` (never
   hand-write the `.sql`), then run `pnpm db:migrate` against the dev DB to
   confirm it applies cleanly.
3. Self-check: `pnpm typecheck` in both `server/` and `client/` passes (the
   new optional/nullable fields must not break any existing caller — nothing
   currently constructs these objects without the new fields, since they're
   all optional/nullable).

### Implementer 2 — Server: concurrent execution, targeting, grouping, clustering (T3, T4, T5, T6, T7, T14)

*Depends on: Implementer 1 (needs the new contract fields and the
`multi_agent_run_id` column to exist).*

4. **T3 — `ReviewService.resolveTargets`**: add a new branch for
   `opts.agentIds`, alongside the existing `opts.all`/`opts.agentId` checks
   (`service.ts:48-59`). For each id, resolve via `this.agents.getById(workspaceId,
   id)` (same call the single-`agentId` branch already uses); if ANY id fails
   to resolve, throw `NotFoundError` immediately — before creating any
   `agent_runs` row (AC-12). Keep the existing `invalid_run_request` (400)
   thrown only when none of `agentId`/`all`/`agentIds` is present.
5. **T4 — `ReviewService.runReview`**: when the resolved `targets.length > 1`
   (regardless of whether they came from `agentIds` or `all:true` with 2+
   enabled agents), insert one new `multi_agent_runs` row
   (`{workspaceId, prId}`) BEFORE creating the `agent_runs` rows, and pass its
   id into each `createAgentRun(...)` call so `agent_runs.multi_agent_run_id`
   is set on every row created by this call (AC-14). When `targets.length <=
   1`, leave it `null` (AC-15). Return the new group id as `run_group_id` in
   `runReview`'s response, threaded up through the route to satisfy AC-16.
6. **T5 — `ReviewRunExecutor.executeRuns`**: replace the sequential
   `for (const {agent, runId} of jobs) { await this.runOneAgent(...) }`
   (`run-executor.ts:160-197`) with a concurrent dispatch — start every job's
   `runOneAgent(...)` promise without awaiting the previous one, then await
   all of them (e.g. `Promise.allSettled`), keeping the existing per-job
   try/catch/log block exactly as-is inside each job's own async function.
   `failAll()` (pre-work failure) and the shared `runLog` fan-out are
   untouched — only the awaiting shape of the per-agent loop changes (AC-13,
   AC-31).
7. **T6 — new `server/src/modules/reviews/findings-cluster.ts`**: a pure
   function, no DB/repo/container import, e.g.
   `clusterFindings(findings: {finding: FindingRow; agentId: string | null;
   agentName: string | null}[]): FindingCluster[]`. Two findings cluster when
   `file` matches literally AND their `[start_line, end_line]` ranges
   (`reviews.ts:34-35` schema columns) overlap or are within ±2 lines of each
   other. `category`/`severity` never affect clustering (AC-18). Each output
   cluster carries every original finding + its agent attribution, never
   deduped or mutated (AC-19, AC-20).
8. **T7 — `GET /pulls/:id/runs`**: in the existing `listRunsForPull`
   query/mapper (backing `ReviewService.listRuns`), select and map the new
   `multi_agent_run_id` column onto each returned `RunSummary` row — no new
   route.
9. **T14 — new endpoint** `GET /pulls/:id/review-groups?run_ids=<csv>`
   (route name chosen per the Constraints section's design decision above;
   adjust the exact path if the user prefers overloading the existing route
   instead — flag that choice back before locking it in). Validates `run_ids`
   as a non-empty comma-separated list of UUIDs, calls
   `service.reviewsForPull`-equivalent narrowed to those `run_id`s (reuse
   `reviewsForPull`'s existing DB call, filter in memory by `run_id` — do not
   assume a DB-level uniqueness `reviews.run_id` doesn't have, per the
   Constraints note above), then runs T6's `clusterFindings` over the
   resulting findings. Response shape:
   `{ reviews: ReviewDto[], clusters: FindingCluster[] }`.
10. Self-check: `pnpm typecheck` and `pnpm exec vitest run --exclude
    '**/*.it.test.ts'` in `server/` still pass against the pre-existing suite
    (no new test files added by this implementer, per the binding
    constraint — this only confirms nothing pre-existing broke).

### Implementer 3 — Client: run request + tab shell + Configure run screen (T8, T9, T10)

*Depends on: Implementer 1 (contract fields) and Implementer 2 (the
`run_group_id`/`multi_agent_run_id` fields must actually be populated by the
server for the tab to have real data to show, and `GET /agents/:id/stats` is
already unchanged/pre-existing so no new dependency there).*

11. **T8 — `useRunReview`**: add an `agentIds?: string[]` field to
    `RunReviewInput` (`client/src/lib/hooks/reviews.ts:130-145`), forwarded
    into the POST body alongside the existing `agentId`/`all` handling. New
    pure helper `client/src/lib/multi-agent-runs.ts` (see Constraints —
    modeled after `client/src/lib/eval-runs.ts`'s `RunGroup`/`groupRuns`
    shape): groups a `RunSummary[]` by `multi_agent_run_id`, newest group
    first (by the max `ran_at` inside each group), dropping rows with a
    `null` multi_agent_run_id from the "grouped" result (they're single-agent
    runs, out of scope for this tab).
12. **T9 — new `_components/MultiAgentReviewTab/`**: empty state +
    "Start New Review" button when there is no past group run for this PR
    (AC-2); when at least one exists, show the newest group's results
    immediately with "Start New Review" still visible (AC-3); clicking
    "Start New Review" swaps the tab's content to `ConfigureRunScreen` (T10,
    AC-4) instead of navigating away. Wire this tab into
    `PrDetailHeader.tsx`'s `Tabs` list (`PrDetailHeader.tsx:111-121`) as a new
    `multi-agent` key, and into `page.tsx`'s `tab === "..."` render switch
    (same `?tab=` pattern already used for `overview`/`findings`/`diff`/
    `blast`).
13. **T10 — new `_components/ConfigureRunScreen/`**: renders one row per
    workspace agent (enabled AND disabled, matching `RunReviewDropdown`'s
    "show all" precedent), each with a checkbox defaulting to `agent.enabled`.
    Cost estimate = sum of checked agents' `avg_cost_usd` (skip
    `null`/agents with no run history, label that row "no run history" —
    AC-6). Time estimate = max of checked agents' `avg_latency_ms`, not a sum
    (AC-7, because T5 makes them run concurrently). "Run multi-agent review
    (N)" button disabled when N=0 (AC-8); on click, calls `useRunReview`
    (T8) with `{agentIds: [...checked ids]}`, then switches the tab back to
    Columns view of the just-created group (AC-9).
14. Self-check: `pnpm typecheck` in `client/` passes; `pnpm test` (existing
    suite) still passes.

### Implementer 4 — Client: results views, disagreement section, trace wiring, i18n (T11, T12, T13, T15, T16)

*Depends on: Implementer 2 (T14's `review-groups` endpoint + clusters) and
Implementer 3 (the `MultiAgentReviewTab` shell these views render inside).*

15. **T11 — new `_components/ColumnsView/`**: one card per run in the current
    group — `CircularScore` (as `RunHistory.tsx:168` already does), agent
    name, `RunCostBadge`, a status badge (reuse `RunHistory.tsx:25-39`'s
    `outcomeOf` logic or extract it if a shared import is cleaner), this run's
    findings (title + `file:line` + severity icon via `SEV`), and a "View
    trace" action. Re-renders on `usePrRuns`'s existing 4s poll while any run
    in the group is `running` (AC-27) — no new poll loop.
16. **T12 — new `_components/TabsDetailView/`**: one tab per agent in the
    group (score badge in the tab itself), showing `review.score` +
    `review.summary`, then the group's `FindingCard` list filtered to that
    agent's findings — reusing `FindingCard` as-is (AC-29 is satisfied for
    free, per the Constraints note; do not add a Learn/Reply button).
17. **T13 — new `_components/AgentsDisagreeSection/`**: consumes T14's
    `clusters` response. One row per cluster × agent-in-group: severity+title
    if that agent flagged something in the cluster, "did not flag" if
    `status:'done'` and nothing found, "pending"/"failed" (not "did not
    flag") if that agent's run is `running`/`failed`/`cancelled` (AC-23).
    "Show only conflicts" toggle, default OFF (same default convention as
    `FindingsPanel.tsx:41`'s `hideLow`), hides clusters where every present
    `done` agent agrees (same severity, or all "did not flag"); a cluster with
    exactly one `done` agent counts as unanimous too (AC-24).
18. **T15 — wire "View trace"**: every "View trace" action in `ColumnsView`
    (T11) and `TabsDetailView` (T12) calls the same `setParam("trace", runId)`
    mechanism `page.tsx` already exposes (`page.tsx:211-219`'s
    `RunTraceDrawer` + `?trace=` query param) — no new drawer, no fork.
19. **T16 — i18n**: add new keys under `client/messages/en/prReview.json` (or
    the nearest existing namespace used by sibling PR-detail components) for
    every new user-facing string introduced by T9-T13 ("Start New Review",
    "Configure run", "Run multi-agent review ({n})", "no run history",
    "Show only conflicts", "did not flag", "pending", "failed", the
    Columns/Tabs view-switch labels).
20. Self-check: `pnpm typecheck` and `pnpm test` (existing suite) pass in
    `client/`; manually confirm (via the running dev app, not a new test) that
    the `multi-agent` tab renders end-to-end for a 2+-agent run.

## Test plan

No implementer in this workflow authors new tests (binding constraint above).
The following is what `plan-verifier` checks the finished code against — it
mirrors the spec's own Task checklist test citations one-to-one:

- **`server/test/contracts.test.ts`** (extend) — `RunRequest.agentIds`,
  `ReviewRunResponse.run_group_id`, `RunSummary.multi_agent_run_id` all parse;
  old payloads without them still parse (optional/nullable).
- **`server/test/reviews-multi-agent.test.ts`** (new, unit, mocked repo) —
  `resolveTargets` 404s on an unknown/foreign `agentIds` entry BEFORE any
  `insertReview`/`createAgentRun` call.
- **`server/test/reviews-multi-agent.it.test.ts`** (new, integration, real
  Postgres) — covers T2 (column + `onDelete:'set null'` doesn't break group
  deletion), T4 (2 agents → one `multi_agent_runs` row, both `agent_runs`
  linked; 1 agent → `null`), T5 (2 agents, one with a mocked LLM
  delay/failure — both complete, the failed one doesn't block the other;
  optionally assert non-sequential timing), T7 (`GET /pulls/:id/runs` returns
  `multi_agent_run_id`), T14 (`GET /pulls/:id/review-groups` scoped response
  contains only the requested `run_ids`' findings + correct clusters).
- **`server/test/findings-cluster.test.ts`** (new, unit) — same-file
  overlapping/±2-line findings cluster; different files don't; a cluster
  retains every original finding with its agent attribution (no dedup/loss).
- **Client component tests** (new, one per new `_components/` folder, run
  with React Testing Library + Vitest per `TESTING.md`'s client suite):
  `MultiAgentReviewTab.test.tsx` (AC-1..4, and later extended for T15's
  `?trace=` click wiring), `ConfigureRunScreen.test.tsx` (AC-5..9),
  `ColumnsView.test.tsx` (AC-25..27, AC-31), `TabsDetailView.test.tsx`
  (AC-25, AC-28, AC-29 — regression-fixes the "no Learn/Reply button" fact),
  `AgentsDisagreeSection.test.tsx` (AC-21..24), plus a small unit test for the
  new `client/src/lib/multi-agent-runs.ts` grouping helper (T8).

**Commands** (from `TESTING.md`):
```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker
cd client && pnpm test                                          # + pnpm typecheck
```

A pass means: every test above is green, plus `pnpm typecheck` clean in both
`server/` and `client/`, and the pre-existing suites (`reviews.it.test.ts`,
`reviews-skills.it.test.ts`, etc.) are unaffected.

## Out of scope

Architecture review and security review are explicitly **not** this plan's or
any `implementer`'s job — they belong to the `architecture-reviewer` and the
review pass folded into `plan-verifier`/the security checks already baked
into this plan's Constraints section. This plan also does not touch `ci/`,
`agent-runner/`, or `reviewer-core/` (see "Modules involved"), and does not
attempt the NFR's "cap clustering by finding volume" beyond what AC-18/AC-19
already require — that specific numeric cap is explicitly left to a future
plan per the spec's own Open questions.
