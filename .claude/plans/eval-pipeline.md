# Development Plan — Eval Pipeline for the PR-review agent (SPEC-05, L06)

**Execution mode:** multi-agent

## Context

`server/src/modules/evals/` already has a working "one case → one run" path
(`POST /agents/:id/evals/:caseId/run`, `EvalsService.run()`), backed by
`eval_cases`/`eval_runs` tables. What's missing is everything the L06 homework
and SPEC-05 actually grade: typed `must_find`/`must_not_flag` expectations
(today's `expected_output` is `z.unknown()`), a one-click "turn a real
accept/dismiss decision into a regression case" button, a bulk "run the whole
set" endpoint with a shared `run_group_id`, run history + two-run comparison,
and a workspace-wide Eval Dashboard. The goal is to let an agent owner change
a system prompt, hit one button, and see recall/precision/citation_accuracy
move — with zero LLM calls inside the scorer itself.

This plan turns `docs/specs/SPEC-05-eval-pipeline.md`'s Task checklist
(T1–T12) into an ordered implementation plan, with every file:line citation
re-verified against the current tree and the plan-level open questions
resolved below.

## Modules involved

- **server** (`@devdigest/api`) — contract narrowing, new `run_group_id`
  migration, rewritten scorer, `EvalsService.runSet()`, new bulk route, new
  `POST /findings/:id/eval-case` route, seed data.
- **client** (`@devdigest/web`) — "Turn into eval case" button on
  `FindingCard`, "Run all" + run-history + two-run comparison on `EvalsTab`,
  new Eval Dashboard page + nav entry.
- **shared contracts** (`server/src/vendor/shared` **and**
  `client/src/vendor/shared`, two physically separate copies — no shared
  package) — `EvalExpectationType`/`EvalExpectation`, narrowed
  `EvalCaseInput.expected_output`, new `EvalSetRunResult`. Both copies must be
  edited together (root `INSIGHTS.md` 2026-07-31 gotcha — a prior task
  brief updated only the server copy and broke `client`'s `pnpm typecheck`).
- **reviewer-core** — NOT touched. Bulk-run reuses `reviewPullRequest` exactly
  as the existing single-run path already does; no new prompt-assembly or
  grounding-gate code.

## Constraints

From root `CLAUDE.md`:
- Wire contracts are `snake_case` (`run_group_id`, `citation_accuracy`);
  Drizzle/TS stay `camelCase`; the mapping happens explicitly at the route
  boundary — same pattern `toEvalCaseDto`/`toEvalRunDto` already use in
  `server/src/modules/evals/helpers.ts`.
- **Migrations are never hand-edited.** The new `run_group_id` column goes
  through `pnpm db:generate` against `server/src/db/schema/eval.ts`, never by
  editing an applied `.sql` file.
- **Verify migrations by fact, not exit code** — `server/INSIGHTS.md`
  2026-08-11: `pnpm db:migrate` can exit 0 and silently apply nothing in this
  repo (path contains a space). After `db:generate` + `db:migrate`, check
  `\d eval_runs` directly before trusting the column exists (T2's own
  acceptance note already says this).
- **The grounding gate is never bypassed** — bulk-run reuses the same
  `reviewPullRequest` call the single-run path already makes; `citation_accuracy`
  keeps coming from `parseGroundingRatio(outcome.grounding)`, unchanged.
- **The injection guard is never bypassed** — no new diff-to-prompt
  concatenation path is introduced; `input_diff` (hand-written or
  reconstructed by the new button) flows through the same
  `parseUnifiedDiff` → `reviewPullRequest` → `wrapUntrusted()`/`INJECTION_GUARD`
  path the single-run path already uses.

From `server/CLAUDE.md` / onion architecture (see Skills section below):
services depend on the DI container (`platform/container.ts`), routes only
translate HTTP ↔ service calls, adapters stay at the edge.

From `server/INSIGHTS.md`:
- 2026-08-01: `ValidationError` → HTTP 422, not 400 (relevant to AC-3's
  "no `agent_id`" case and the existing empty-diff guard in
  `service.ts:110-112`, which AC-1's Edge Case explicitly says to reuse
  as-is).
- 2026-08-06: `IdParams` (`z.string().uuid()`) validates `:id` **before** the
  handler runs — any new-route test for "unknown id → 404" must use a
  UUID-shaped id, or it gets 422 instead.
- 2026-08-06: a hermetic (no-Postgres) route test is possible via a minimal
  fake `Db` + overridden `overrides.auth` — useful if any new unit-level
  route test is added alongside the `.it.test.ts` coverage T5/T6 call for.

From `client/INSIGHTS.md`:
- 2026-08-02 (×2): `../` import-depth for new nested `_components/` folders
  must be counted with `node -e "path.relative(...)"` or by comparing to an
  existing sibling at the *same* depth — copying depth from a task brief or a
  differently-nested sibling has bitten this exact `EvalsTab`/`EvalCaseModal`
  tree twice already.
- 2026-08-13: `@testing-library/user-event` is **not** installed; all client
  tests use `fireEvent`, not `userEvent` — do not introduce a new dependency
  for the new tests in this plan.
- 2026-07-31 / 2026-08-13: multiple prior "two elements render identical
  text" `getByText` traps in this exact component family (badges, empty
  states) — worth a second look when writing `EvalsTab`/`EvalDashboardView`
  assertions (e.g. the "Never run" empty state per agent, or two runs with
  identical rounded recall values).

**Verified starting-state facts** (re-checked against the current tree, not
assumed from the spec):
- `server/src/db/schema/eval.ts:7-35` — `eval_cases`/`eval_runs` match the
  spec's description exactly; `eval_runs.recall`/`.precision`/
  `.citationAccuracy` are already nullable columns, so AC-14 ("failed case →
  null metrics") needs no schema change beyond adding `run_group_id`.
- `server/src/modules/evals/helpers.ts:4-58` — `ExpectedFinding`/
  `matchFindings()`/`parseGroundingRatio()` match verbatim; `matchFindings`
  matches on `file`+`severity`(+optional `category`/`start_line`), never on
  line-range intersection — confirms T3 fully replaces the matcher rather
  than patching it.
- `server/src/modules/evals/service.ts:102-155`, `routes.ts:73-82`,
  `repository.ts` (`insert`, `insertRun`, `latestRunByCase`) — match as cited.
- `server/src/adapters/git/diff-parser.ts:14-79` — confirmed it requires
  `diff --git a/<path> b/<path>` + `--- a/<path>` + `+++ b/<path>` + an
  `@@ ... @@` header **before** the hunk body; GitHub's `pr_files.patch` has
  only the hunk body, so T6's diff-reconstruction must synthesize exactly
  those three header lines from `pr_files.path`.
- `server/src/db/schema/pulls.ts:36-45` (`pr_files.path`/`.patch`) — matches.
- `server/src/modules/reviews/repository/review.repo.ts:120-134` already
  exports `findingContext(db, findingId) → { finding, review, pull }` — this
  resolves exactly the workspace/`agent_id`/PR data T6 needs (see T6 step
  below for why the plan reuses this instead of new lookup code).
- `server/src/modules/reviews/repository.ts:40` — `getPrFiles(prId)` already
  exists (needed to find the file's `.patch` for reconstruction).
- `server/src/db/seed.ts:451-490` (spec cited 451-488 — 2-line drift, still
  holds) — **only 2** demo eval cases exist today, one on `testQualityAgent`
  and one on `securityAgent`, **both in the pre-`EvalExpectation` flat shape**
  (`{severity, file, category}`, no `type` field). T10 must not just append 6
  more cases — it must (a) consolidate all ≥8 cases onto **one** demo agent
  (spec's literal wording: "≥8 cases for one demo agent") and (b) rewrite the
  2 existing entries into the new `{type: 'must_find'|'must_not_flag', ...}`
  shape, since `scoreEvalCase()` (T3) has no fallback for an entry missing
  `type` — leaving them as-is would make them silently score as neither
  bucket.
- `client/.../EvalsTab/EvalsTab.tsx`, `.../EvalCaseModal/EvalCaseModal.tsx`,
  `client/src/lib/hooks/evals.ts`, `.../FindingCard/FindingCard.tsx`,
  `client/src/vendor/ui/nav.ts` — all match the spec's described shape.
  `EvalCaseModal`'s expected-output editor is already a raw JSON textarea, so
  AC-4 needs **no** modal change — it already round-trips whatever JSON shape
  is stored.
- Rate-limit precedent confirmed: `config: { rateLimit: { max: N, timeWindow:
  '1 minute' } }` in `server/src/modules/reviews/routes.ts:32,64`,
  `server/src/modules/brief/routes.ts:39`.
- `server/package.json:12` (`verify:l03`) — confirmed precedent pattern for
  T11's `verify:l06`.
- All target test files for T1–T6 already exist (`server/test/contracts.test.ts`,
  `server/test/evals-helpers.test.ts`, `server/test/evals.it.test.ts`) — this
  is **extending** existing suites, not creating new ones, for those files.
  `T9`'s dashboard test file is new.
- Pre-existing, unrelated drift (do **not** "fix" as a drive-by): the client
  copy of `eval-ci.ts` is already missing `AgentManifest`/`CiFailOn` and has a
  narrower `ConformanceInput.provider` enum than the server copy — from
  earlier lessons, out of this plan's scope. Only sync the fields this plan
  actually adds (`EvalExpectationType`, `EvalExpectation`, narrowed
  `EvalCaseInput.expected_output`, new `EvalSetRunResult`).

**Resolved open questions (Development-Plan level, per SPEC-05's Open
questions section — no further product sign-off required):**

1. **`run_group_id` DDL shape** — a nullable, indexed `uuid` column on
   `eval_runs` (not a separate `eval_run_groups` table). This was already the
   Task checklist's own T2 wording; carried through as-is. One `run_group_id`
   value is shared by N `eval_runs` rows (one per case) for a single bulk
   invocation; a single-case run (`POST .../:caseId/run`) leaves it `null`.
2. **Sequential vs parallel case execution inside bulk-run** — **sequential**
   (`for...of`, awaiting each case in turn, catching per-case errors for
   AC-14). Rationale: bounds peak concurrent LLM calls to 1 (vs. fan-out to N
   simultaneous provider calls), keeps cost/duration bookkeeping trivially
   attributable per case, and set sizes here are small (~8 cases) so the
   wall-clock cost of sequential execution is acceptable for a manually
   triggered "Run all" button — not a hot path.
3. **Eval Dashboard rate-limit / pagination** — neither is needed. It's a
   pure DB read (no LLM call), so cost-abuse doesn't apply, and workspace
   scale here is small (course project). The one thing the implementer must
   verify explicitly is that the aggregate is built with **at most one or
   two queries total**, not one query per agent (N+1) — see T9 below.
4. **Set-run deletion** — stays out of scope, per the spec's own Non-goals.
   Do not add a delete-run-group endpoint or UI in this pass.

**Also out of scope, per the spec's own text** (do not implement, just be
aware they exist as separate, already-flagged follow-ups):
- Backfilling a rate limit onto the existing, currently-unlimited
  `POST /agents/:id/evals/:caseId/run` (spec's NFR section flags this as a
  pre-existing gap, explicitly not part of SPEC-05).
- Trend graphs (`EvalTrendPoint`/`EvalDashboard.trend`/`.delta`/`.alert` at
  the dashboard-aggregate level) — only the two-run comparison (AC-18) and
  the dashboard's per-agent "last set-run" list (AC-20) are in scope.
- A `PreToolUse` hook gating prompt/code changes on a green eval run.
- Mutation testing of the eval cases themselves.
- Verifying accept/dismiss decisions as ground truth before trusting them.
- A parallel `owner_kind: 'skill'` eval UI.

## Skills the implementer will use

- **`onion-architecture`** — every server change touches
  `server/src/modules/evals/**` (service/repository/routes) and a new
  cross-module read from `server/src/modules/reviews/repository/review.repo.ts`
  (T6). Services must keep resolving adapters/repos through the DI container
  (`platform/container.ts`), and the new route files must stay thin
  (HTTP ↔ service only). This skill also governs where T6's new logic lives
  (see T6 step — reading another module's repository directly for a lookup is
  an established, precedented pattern here, per `server/INSIGHTS.md`
  2026-08-11's note on `repo-intel`/`reviews` reading `t.repos` directly).
- **`zod`** — T1's contract work (`EvalExpectationType`, `EvalExpectation`,
  narrowed `EvalCaseInput.expected_output`, new `EvalSetRunResult`) is pure
  Zod schema authoring; keep the `.nullish()`/`.optional()` conventions
  already used throughout `eval-ci.ts`.
- **`drizzle-orm-patterns`** — T2's new `run_group_id` column + index and the
  `pnpm db:generate` migration workflow.
- **`fastify-best-practices`** — T5/T6's new routes: schema-first
  params/body validation via `fastify-type-provider-zod`, route-level
  `config.rateLimit`, and NotFoundError/ValidationError usage consistent with
  the existing `evalsRoutes`/`reviewsRoutes` plugins.
- **`react-best-practices`** + **`react-ui-architecture`** — T7 (FindingCard
  button + new hook placement in `client/src/lib/hooks/evals.ts`), T8
  (EvalsTab history/comparison UI), T9 (new `EvalDashboardView` component
  placement under `client/src/app/eval-dashboard/_components/`).
- **`react-testing-library`** — all client `*.test.tsx` work (T7–T9); keep
  using `fireEvent`, not `userEvent` (client/INSIGHTS.md 2026-08-13 — the
  package isn't installed and this plan must not touch the lockfile).
- **`security`** — re-check AC-22/AC-23's access-control and rate-limit
  requirements are actually implemented as specified once T5/T6 are done;
  the spec's own NFR section already did the OWASP pass, this is a
  verification, not a fresh review.

## Ordered steps

### Server — contracts (T1)

1. In `server/src/vendor/shared/contracts/eval-ci.ts`: add
   `EvalExpectationType = z.enum(['must_find', 'must_not_flag'])` and
   `EvalExpectation` (`type`, `file`, `start_line?`, `end_line?`, `severity?`,
   `category?`) exactly as specified in the spec's Goals section. Narrow
   `EvalCaseInput.expected_output` from `z.unknown()` to
   `z.array(EvalExpectation)`. Add `EvalSetRunResult = z.object({
   run_group_id, aggregate: { recall, precision, citation_accuracy },
   cases: z.array(EvalRunRecord) })`.
2. Port the **identical** diff into `client/src/vendor/shared/contracts/eval-ci.ts`
   (same file, same exports) — do not let this drift the way
   `findings_summary` did (root `INSIGHTS.md` 2026-07-31). Do not touch the
   client copy's pre-existing, unrelated gaps (`AgentManifest`, `CiFailOn`,
   `ConformanceInput.provider`) — out of scope.
3. Extend `server/test/contracts.test.ts` with fixtures: `EvalExpectation.parse(...)`
   for both `type` values, a narrowed `EvalCaseInput.parse(...)` fixture
   (array of `EvalExpectation`, not the old untyped shape), and
   `EvalSetRunResult.parse(...)`.

### Server — schema + migration (T2)

4. Add `runGroupId: uuid('run_group_id')` (nullable) to `pgTable('eval_runs',
   ...)` in `server/src/db/schema/eval.ts:22-35`, with an index (Drizzle
   `index()` on the table, following existing index patterns elsewhere in
   `db/schema/*.ts`, e.g. `pulls.ts`'s `wsIdx`).
5. Generate the migration (`pnpm db:generate` inside `server/` — remember the
   `pnpm exec`-build-approval gotcha from root `INSIGHTS.md` 2026-07-28 if it
   fires; fall back to invoking `drizzle-kit`'s bin directly if `pnpm
   db:generate` hangs on an unapproved build script). Apply it and **verify
   by fact** — `\d eval_runs` must show the new column — never trust exit
   code alone (server/INSIGHTS.md 2026-08-11).
6. Extend `server/test/evals.it.test.ts` with a round-trip: insert several
   `eval_runs` rows sharing one `run_group_id`, read them back grouped.

### Server — scorer rewrite (T3)

7. Rewrite `server/src/modules/evals/helpers.ts`: remove `ExpectedFinding`/
   `matchFindings()`, add `scoreEvalCase(expectations: EvalExpectation[],
   actual: Finding[]) → { pass, recall, precision, matched }` implementing
   AC-6 (recall = fraction of `must_find` expectations with ≥1 matching
   actual finding by `file` + line-range intersection, or `file`-only match
   when no range is given; empty `must_find` set → `recall = 1`), AC-7
   (precision = fraction of actual findings **not** intersecting any
   `must_not_flag` zone; findings outside all zones are neutral, **not**
   penalized; empty actual-findings set → `precision = 1`), and AC-10
   (a range marked both `must_find` and `must_not_flag` contributes to both
   the recall numerator and the precision penalty independently — no
   validation blocks this case). Leave `parseGroundingRatio()` untouched.
8. Extend `server/test/evals-helpers.test.ts` (do not replace — it already
   covers the old `matchFindings`, which is being deleted, so those specific
   cases get replaced by their `scoreEvalCase` equivalents): `must_find`
   matched/missed, a `must_not_flag` false positive penalizing precision, a
   finding outside all zones *not* penalizing precision, the AC-10
   overlapping-zone case, and both empty-set → `1` defaults.

### Server — service + bulk run (T4)

9. In `EvalsService`: switch `run()` to call `scoreEvalCase()` instead of
   `matchFindings()`. Factor the per-case "resolve agent + linked skills once,
   call `reviewPullRequest`, score, persist" logic so it can be called from a
   loop **without** re-fetching the agent/skills for every case in a set —
   `run()` keeps its existing single-case entry point; add a private helper
   both `run()` and the new `runSet()` call.
10. Add `runSet(workspaceId, agentId, logger)`: load the agent + linked
    skills once, load all of the agent's `eval_cases`, throw `ValidationError`
    (→ 422, per `server/INSIGHTS.md` 2026-08-01) if the set is empty — **before**
    any LLM call (AC-13). Generate one `run_group_id` (`crypto.randomUUID()`
    or Drizzle's default-random equivalent). Execute cases **sequentially**
    (resolved open question #2 above), wrapping each case's `reviewPullRequest`
    call in a try/catch: on failure, persist a row with `pass: false`,
    `recall`/`precision`/`citationAccuracy: null` (AC-14) and continue to the
    next case — never abort the whole set. Persist each case's `eval_runs`
    row with the shared `run_group_id`. Compute the aggregate as a **simple
    macro-average** across cases (AC-12, resolved 2026-08-19) — every case
    weighs equally regardless of how many expectations or findings it has;
    a failed case (null metrics) should be excluded from the average's
    denominator for that metric, not treated as `0`, to avoid conflating "an
    LLM call failed" with "the model scored zero" (log this exclusion
    explicitly).
11. Extend `server/test/evals.it.test.ts`: bulk-run persists N rows sharing
    one `run_group_id`; empty set → 422 with zero LLM calls (assert the mock
    LLM was never invoked); one case's mock LLM throws → that case's row has
    `pass: false`/null metrics, but the rest of the set still completes and
    persists.

### Server — routes (T5, T6)

12. Add `POST /agents/:id/eval-runs` to `server/src/modules/evals/routes.ts`:
    `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` (tighter than
    the `{max: 10, ...}` precedent in `reviews/routes.ts`/`brief/routes.ts`,
    per AC-22's cost-abuse rationale — bulk fans out to N LLM calls per
    request). Verify the agent belongs to the caller's workspace (reuse the
    existing `getContext` + `AgentsRepository.getById(workspaceId, id)`
    pattern) **before** calling `service.runSet` (AC-23) — a miss returns 404.
    Confirm the existing `POST /agents/:id/evals/:caseId/run` route is
    untouched (AC-15).
13. Extend `server/test/evals.it.test.ts`: 429 on exceeding the bulk
    rate-limit, 404 on a foreign-workspace agent id, and a regression check
    that the existing single-run route's tests still pass unmodified.
14. Add `POST /findings/:id/eval-case`. Placement decision (resolves the
    spec's "reviews/service.ts or an adjacent module" ambiguity): implement
    it as a new method on `EvalsService` (e.g. `createFromFinding`), since the
    write belongs to the module that owns `eval_cases`. For the **read** side,
    instantiate/use `ReviewRepository` directly to call the already-existing
    `findingContext(findingId)` (`review.repo.ts:120-134`, returns
    `{finding, review, pull}`) and `getPrFiles(prId)` — this is the same
    "read another module's data via your own repository call" pattern already
    established for reads in this codebase (`server/INSIGHTS.md` 2026-08-11:
    `repo-intel`/`reviews` already read `t.repos` directly from their own
    `repository.ts` files). Register the route in
    `server/src/modules/reviews/routes.ts` (URL groups under `/findings/:id/*`
    alongside the existing accept/dismiss actions there), delegating to the
    new `EvalsService` method.
    - AC-1: build one `EvalExpectation` from the finding (`type: 'must_find'`
      if `accepted_at` is set, `'must_not_flag'` if `dismissed_at` is set;
      `file`/`start_line`/`end_line`/`severity`/`category` copied verbatim,
      never concatenated into any prose field — matches the spec's Untrusted
      Inputs note).
    - AC-2/AC-3: 422 (`ValidationError`) if neither timestamp is set, or if
      `review.agentId` is null.
    - Reconstruct `input_diff`: find the matching `pr_files` row by
      `finding.file === prFile.path`, synthesize `diff --git a/<path>
      b/<path>` + `--- a/<path>` + `+++ b/<path>` + a `@@ -0,0 +1,<n> @@`-shaped
      header (or a header derived from the patch's own hunk range if present)
      in front of the raw `.patch` body, per the diff-parser's requirements
      confirmed above. If `.patch` is empty/null, still create the case with
      an empty `input_diff` (Edge case in the spec — the future run then hits
      the existing empty-diff `ValidationError` guard at `service.ts:110-112`,
      unchanged).
    - AC-23: 404 before any DB write if the finding's PR doesn't belong to
      the caller's workspace (`findingContext`'s `pull.workspaceId` check).
15. Extend `server/test/evals.it.test.ts`: accepted finding → `must_find`
    case; dismissed → `must_not_flag`; finding without either timestamp →
    422; review with null `agent_id` → 422; foreign-workspace finding → 404.

### Client — FindingCard button (T7)

16. Add "Turn into eval case" to
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
    — active only when `f.accepted_at` or `f.dismissed_at` is set (AC-2,
    matches the existing `accepted`/`dismissed` booleans already computed in
    this component). Add `useCreateEvalCaseFromFinding` to
    `client/src/lib/hooks/evals.ts` (`POST /findings/:id/eval-case`). On
    success, surface a toast/link that opens the created case in `EvalsTab`'s
    existing `EvalCaseModal` (AC-4) — do not build a new editing surface.
    Count `../` import depth explicitly for any new file
    (`node -e "console.log(path.relative(fromDir, toDir))"`), per
    client/INSIGHTS.md's repeated depth-miscount gotcha in this exact tree.
17. Extend `client/.../FindingCard/FindingCard.test.tsx`: button
    hidden/disabled without a decision, click fires the mutation with the
    correct `EvalExpectation.type`.

### Client — EvalsTab run-all + history + comparison (T8)

18. Extend `EvalsTab.tsx`: "Run all" button calling the new
    `POST /agents/:id/eval-runs` hook; a run-history list grouped by
    `run_group_id` (AC-17, newest first); selecting exactly two runs renders
    a comparison view with per-metric deltas (new − old, AC-18) **and**
    per-case pass/fail transitions (AC-19) — a case missing from one of the
    two runs (set changed between runs) renders as "no data" for that run,
    never as a fabricated `fail` (spec's Edge case). Never render a
    regression/improvement indicator unless exactly two runs are selected
    (AC-25). Always render recall/precision/citation_accuracy/cost/duration
    as separate values — never compute or show one collapsed score (AC-24).
19. Extend `client/.../EvalsTab/EvalsTab.test.tsx`: "Run all" triggers the
    mutation, history renders, selecting two runs shows deltas + per-case
    transitions, a single run shows no regression badge.

### Client — Eval Dashboard (T9)

20. Add `{key: "eval-dashboard", label: "Eval Dashboard", icon: ..., href:
    "/eval-dashboard"}` to the `SKILLS LAB` section in
    `client/src/vendor/ui/nav.ts` (no `:repoId` token — this page is
    workspace-wide, per AC-20). Add
    `client/src/app/eval-dashboard/page.tsx` (thin, delegates to
    `_components/EvalDashboardView`). The view lists every agent in the
    workspace with its latest set-run's aggregate metrics, case count, and
    run time; agents with no set-run yet show a "Never run" empty state
    without erroring (AC-21). Server-side, this needs a new read path (either
    a new `GET /agents/eval-dashboard`-style endpoint or reuse of existing
    per-agent list + latest-run-group lookups) — implementer's choice, but it
    **must** resolve to at most one or two aggregate queries total, not one
    query per agent (resolved open question #3 above — explicitly verify this
    with the query count, not just visually).
21. New `client/src/app/eval-dashboard/_components/EvalDashboardView/EvalDashboardView.test.tsx`:
    renders the per-agent list, and the "Never run" empty state for an agent
    with zero set-runs.

### Server — seed data (T10)

22. In `server/src/db/seed.ts`, consolidate eval cases onto **one** demo
    agent (pick either `testQualityAgent` or `securityAgent` — whichever
    already anchors more of the surrounding demo narrative) and grow the set
    to **≥8** cases, mixing `must_find`/`must_not_flag`, all in the new
    `EvalExpectation` shape. Migrate the 2 existing entries
    (`happy-path-only-test`, `route-signature-change`) into the new shape
    (add `type: 'must_find'`, keep their existing `file`/`severity`/`category`)
    rather than leaving them in the old flat shape. This is demo data, not
    behavior — no new AC, verified manually (`pnpm db:seed` +
    `SELECT count(*) FROM eval_cases WHERE owner_id = '<agent-id>'`), not by
    an automated test.

### Server — verify script (T11)

23. Add `"verify:l06"` to `server/package.json`, following the `verify:l03`
    precedent (`server/package.json:12`): `vitest run` over the exact set of
    files touched by T1–T6 (`src/modules/evals/**` unit tests,
    `test/evals-helpers.test.ts`, `test/evals.it.test.ts`,
    `test/contracts.test.ts`) — finalize the literal file list once T1–T6 are
    actually written, not guessed in advance.

### Manual acceptance demo (T12)

24. Not an automated task for the implementer to "complete" via a
    test — a documented manual walkthrough: create one eval case from an
    accepted finding and one from a dismissed finding (AC-1, one click each);
    run `POST /agents/:id/eval-runs` against the current system prompt and
    record recall/precision/citation_accuracy (AC-12); deliberately weaken
    the prompt (remove the instruction to catch critical issues); run again;
    confirm precision visibly drops; open the two-run comparison in the UI
    (AC-18) and capture a screenshot; record an end-to-end screencast (button
    → ≥8-case set → "Run all" → comparison). This step happens **after**
    T1–T11 are implemented and verified — it's the homework's own acceptance
    evidence, not something `plan-verifier`/`architecture-reviewer` checks.

## Test plan

Run the smallest check that could have caught each change, per root
`CLAUDE.md`'s eval-routing table — but since this plan touches product code,
not the `evals/` harness package, the relevant commands are from
`TESTING.md`, not `pnpm eval:*`:

- **Server unit** (hermetic, no Docker): `cd server && pnpm exec vitest run
  --exclude '**/*.it.test.ts'` — must cover `contracts.test.ts` and
  `evals-helpers.test.ts`'s new/changed cases.
- **Server integration** (needs Docker/testcontainers, self-skips if absent):
  `cd server && pnpm exec vitest run .it.test` — must cover `evals.it.test.ts`'s
  new bulk-run, rate-limit, access-control, and finding→case cases.
- **Server, both**: `cd server && pnpm test`.
- **Server typecheck**: `cd server && pnpm typecheck` (also the
  `@ast-grep/napi` Windows prebuilt gate, per `TESTING.md`).
- **Client**: `cd client && pnpm test` (component/interaction tests for
  `FindingCard`, `EvalsTab`, new `EvalDashboardView`) and
  `cd client && pnpm typecheck` (catches contract drift between the two
  `eval-ci.ts` copies immediately).
- **The homework's own gate**: `cd server && pnpm run verify:l06` (T11) must
  be green — this is the literal L06 acceptance bar, not a suggestion.
- A pass means: all of the above green, ≥8 seeded cases exist on one agent
  (`pnpm db:seed` + manual `SELECT count(*)`), and T12's manual demo produces
  a visible precision drop plus a two-run comparison screenshot.

## Out of scope

Architecture and security review are **not** part of this plan or the
implementer's job — per the coordinator's own reasoning for choosing
multi-agent mode, that review is explicitly deferred to the
`plan-verifier`/`architecture-reviewer` loop (up to 3 rounds) that follows
implementation, with an optional `doc-writer` pass after. The implementer
should implement and verify via the Test plan above, not self-certify
architecture or security soundness beyond following the Skills listed.

Also explicitly out of scope for this plan (see Constraints/resolved-open-
questions above for the reasoning): set-run deletion, dashboard trend
graphs, a `PreToolUse` eval-gating hook, mutation testing of eval cases,
ground-truth verification of accept/dismiss decisions, a parallel
`owner_kind: 'skill'` eval UI, and backfilling a rate limit onto the existing
single-case run endpoint.

## Addendum (2026-08-19) — T13: correct T6/T7 to match the reference video

**Why:** SPEC-05's original AC-1/AC-4 decision ("one click, no intermediate
modal, literally per the homework text") was a misreading. A screen
recording of the course's reference implementation (a real running
DevDigest instance, not a mockup) shows "Turn into eval case" opening the
**existing** `EvalCaseModal` pre-filled and unsaved — not an immediate
create+toast. Full reasoning and the corrected AC-1/AC-4 wording are in
`docs/specs/SPEC-05-eval-pipeline.md`'s Open questions section and its new
Task T13. This addendum is the ordered-steps equivalent of that spec's T13
for the implementer to follow; T1–T12 above are otherwise unchanged and
already implemented/verified.

**Good news:** `EvalRun` (`server/src/vendor/shared/contracts/knowledge.ts:98-107`)
already carries everything the reference's "Actual output" panel and run-status
banner need — `per_trace[].actual`, `traces_passed`, `traces_total`,
`duration_ms`, `cost_usd`. This is a rendering gap in `EvalCaseModal.tsx`,
not a missing-data gap. No contract change needed for that part.

### Steps

1. **Server — stop persisting on build** (`server/src/modules/evals/service.ts`,
   `createFromFinding`): remove the `EvalsRepository.insert(...)` call: keep
   the finding/review/PR resolution, the workspace-ownership 404 check
   (AC-23 — still runs before returning anything), and the diff
   reconstruction, but return the built draft
   (`{owner_id, name, input_diff, input_meta, expected_output}`, no `id`,
   no DB row) instead of a persisted `EvalCase`. Route (`reviews/routes.ts`'s
   `POST /findings/:id/eval-case`) keeps its 201 status or drops to 200
   (implementer's call — no row is created, so 200 "here's your draft" reads
   more accurately than 201 "created").
2. **Client — hook returns a draft, doesn't persist** (`client/src/lib/hooks/evals.ts`,
   `useCreateEvalCaseFromFinding`): drop the `onSuccess` cache-invalidation
   (nothing was written yet) — it now just returns the draft shape to the
   caller.
3. **Client — `FindingCard.tsx`'s `onTurnIntoEvalCase`**: instead of calling
   the mutation and showing a toast+deep-link (the round-2 fix — this
   supersedes it), call the mutation to fetch the draft, then open
   `EvalCaseModal` (lift it up to wherever `FindingCard` can render a modal,
   or bubble an "open modal with this draft" callback up to the page level —
   implementer's call on the cleanest lift point) passing the draft as
   initial values and a `seededFrom: 'accepted' | 'dismissed'` marker. The
   `EvalsTab.tsx` `?case=` deep-link handling from round 2 can stay if it's
   still useful for other entry points, or be removed if `FindingCard` was
   its only caller — check before deciding.
4. **`EvalCaseModal.tsx` — seeded-mode additions**:
   - Optional prop (e.g. `seededFrom?: 'accepted' | 'dismissed'`): when set,
     render the subtitle "Seeded from an accepted/dismissed finding — assert
     the expected output" under the modal title.
   - A POSITIVE CASE / NEGATIVE CASE badge, derived from
     `expected_output[0].type` (`must_find` → POSITIVE, `must_not_flag` →
     NEGATIVE) with a human summary line ("MUST find "<title>" at
     <file>:<start_line>" — `title` can come from `input_meta.title` if
     present, else fall back to the file path alone). Not exclusive to
     seeded mode — render it whenever `expected_output` has exactly one
     entry, seeded or manually edited to that shape.
   - **Actual output** panel: render `run.data?.run.per_trace[0]?.actual`
     as formatted JSON (reuse whatever JSON-pretty-print convention the
     Expected output textarea already uses), not just the current pass/fail
     `Badge`.
   - Run-status banner: replace/extend the current pass/fail `Badge` with a
     full-width banner showing pass/fail + `traces_passed`/`traces_total` +
     `duration_ms` (seconds) + `cost_usd` (e.g. "✕ Last run failed · 0/1
     passed · 8.2s · $0.00").
   - **"Finding skeleton"** button next to the Expected output label:
     inserts one template `EvalExpectation` object into the `expectedText`
     JSON array (parse current text, append `{type: 'must_find', file: '',
     start_line: 0, end_line: 0, severity: 'WARNING', category: '', title:
     ''}`, re-stringify) — a manual-authoring aid, available regardless of
     seeded/manual mode.
   - **"Run on save"** toggle: when on, the Save button's `onClick` becomes
     `saveAndRun` instead of `save` (both already exist on the component).
   - Third tab **"Files"** alongside Diff/PR meta: parse `diff --git a/<path>
     b/<path>` headers out of the current `diff` textarea value and render
     the distinct file paths as a simple list — no new data source, pure
     derivation from what's already in state.
5. **Tests**:
   - `FindingCard.test.tsx`: clicking "Turn into eval case" opens the modal
     with the draft (not: fires a mutation that immediately persists/toasts).
   - `EvalCaseModal.test.tsx`: seeded-mode subtitle+badge render; Actual
     output shows the run's JSON after "Run case"; Finding skeleton
     appends a template entry; Run on save changes Save's behavior; Files
     tab lists parsed paths.
   - `evals.it.test.ts`: the finding→eval-case endpoint no longer inserts a
     row (assert `eval_cases` count unchanged after calling it); the
     existing manual create/update paths still persist correctly (regression
     check, unchanged behavior).

### Explicit non-goal for T13

Do not redesign anything about T1–T5, T8–T12 — this addendum only touches
the finding→case creation path and `EvalCaseModal`'s own UI. Bulk-run,
history/comparison, and the Dashboard are unaffected and already verified.

## Addendum 2 (2026-08-19) — T14: Eval Dashboard trend/sparkline/version/history

**Why:** the user shared a reference-video screenshot of the Eval Dashboard showing per-agent
sparklines, an ordinal run version (`v7`, `v6`, ...), a model badge, and a cross-agent "Recent eval
runs" history table. SPEC-05 had explicitly deferred this as a Non-goal (course material calls it
Stretch, "no deadline") — the user explicitly chose to build it now anyway, ahead of the Aug 23
deadline. Full reasoning: `docs/specs/SPEC-05-eval-pipeline.md`'s Non-goals (struck-through item)
and Task T14.

**Good news:** `EvalsService.dashboard()` (`server/src/modules/evals/service.ts:319-357`) already
fetches ALL of an agent's set-runs via `repo.allSetRuns()` and groups them by `run_group_id` — it
just discards every group except the newest. No new DB query is needed, only keeping what's already
fetched.

### Steps

1. **Server contract** (`server/src/modules/evals/service.ts:61`, `EvalDashboardAgentSummary`):
   add `EvalDashboardRunSummary { run_group_id, version, ran_at, cases_total, cases_passed, recall,
   precision, citation_accuracy }`. `version` is an ordinal counter per agent (1 = that agent's
   oldest set-run, by `ran_at` ascending) — NOT the `agent_versions` table's config-version concept,
   don't conflate them. `EvalDashboardAgentSummary` gains `agent_model: string` (from `agents.model`,
   already loaded by `agents.list()` — no new query) and `recent_runs: EvalDashboardRunSummary[]`
   (newest-first, cap at 10). `last_run` becomes `recent_runs[0] ?? null` (keep the field name/shape
   for backward compat with existing `EvalsTab`/anything else reading it, if applicable — check
   call sites before changing the shape).
2. **Client contract mirror** (`client/src/lib/hooks/evals.ts`): duplicate the same shape into the
   client-side `EvalDashboardAgentSummary`/new `EvalDashboardRunSummary` interfaces — this pair is
   NOT a shared zod contract (route-response shape, deliberately duplicated per existing convention
   for `EvalCaseWithLastRun` — see root `INSIGHTS.md` 2026-07-31 on why these drift-prone dual copies
   exist and must be kept in sync by hand).
3. **`EvalDashboardView.tsx` — agent cards**: replace the current plain-text rows with cards: agent
   name, a small model badge (`agent_model`), "Last run v{version} · {ran_at} · {cases_passed}/
   {cases_total} pass", a small inline sparkline of `recent_runs[].recall` (oldest→newest, left to
   right) — hand-roll a minimal `<svg>`/`<polyline>` sparkline (no axes/grid/legend); do NOT reuse
   `client/src/vendor/ui/charts/LineChart.tsx` for this — that component renders a full chart with
   `ResponsiveContainer`/`CartesianGrid`/axes, which is the wrong visual weight for a tiny trend
   indicator inside a card and has already shown `ResponsiveContainer` sizing flakiness in this
   codebase's own smoke tests (0-width warnings under jsdom). Then RECALL/PREC/CITE as colored
   numbers (reuse whatever color tokens the existing `EvalsTab`/`EvalCaseModal` already use for
   these three metrics, for visual consistency across the app). "Never run" (AC-21) stays unchanged
   for agents with an empty `recent_runs`.
4. **`EvalDashboardView.tsx` — "Run all agents" button**: top-right, client-side loop calling the
   existing `useRunEvalSet`-style mutation (`POST /agents/:id/eval-runs`) once per agent in the
   list — sequential or `Promise.allSettled`, implementer's call; no new bulk-of-bulk server
   endpoint. Skip agents with zero cases (that endpoint already 422s on an empty set per AC-13 — no
   need to pre-filter defensively, but don't let one agent's failure block the others, matching the
   existing per-case AC-14 spirit at the agent level here).
5. **`EvalDashboardView.tsx` — "Recent eval runs · all agents" section**: flatten `recent_runs`
   across every agent into one list, sorted by `ran_at` descending, render as a table: agent name,
   date, `v{version}` , recall/precision/citation as colored progress bars + `%`, `cases_passed/
   cases_total`. Pure client-side derivation from the same dashboard payload — no new endpoint.
6. **Tests**: extend `EvalDashboardView.test.tsx` (card shows sparkline/version/model, "Recent eval
   runs" section renders rows from multiple agents, empty state unchanged) and the dashboard's
   existing coverage in `server/test/evals.it.test.ts` (multiple set-runs for one agent → all appear
   in `recent_runs`, `version` increases chronologically, `last_run` matches the newest).

### Explicit non-goal for T14

Do not touch `EvalsTab`'s own two-run comparison view (AC-18) — that stays scoped to exactly two
user-selected runs, unaffected by this dashboard-level trend addition. Do not introduce a real
"agent config version" concept tied to `agent_versions` — `version` here is purely an eval-run
ordinal, scoped to this dashboard's display.

## Addendum 3 (2026-08-19) — T15: per-agent Eval Dashboard drill-down + Compare modal (prompt diff + Promote)

**Why:** the user shared 3 new reference-video screenshots (seen for the first time, not previously
available in this session) showing a per-agent Eval Dashboard detail page and a "Compare runs" modal
with a system-prompt diff and a "Promote" button. This is genuinely new scope beyond T14 (which only
built the workspace-level flat agent list) — full reasoning and locked-in design decisions are in
`docs/specs/SPEC-05-eval-pipeline.md`'s Open questions section and its new Task T15. Read T15 in the
spec first — it fixes several design choices the mockup didn't literally specify (route, prompt
snapshot storage, "Promote" semantics, banner-generation rule) so the implementer doesn't have to
improvise them.

### Steps

1. **Schema + migration**: add `systemPromptSnapshot: text('system_prompt_snapshot')` (nullable) to
   `evalRuns` in `server/src/db/schema/eval.ts`. Generate the migration (`pnpm db:generate`), apply it,
   and verify by fact (`\d eval_runs`) — same discipline as T2.
2. **`EvalsService.runSet()`** (`server/src/modules/evals/service.ts`): the `agent` row is already
   resolved once at the top of the method — pass `agent.systemPrompt` into `executeCase()`'s
   `repo.insertRun()` call (or thread it through however `executeCase` currently persists a row) so
   every row in the group gets the same snapshot value. `run()` (single-case path) can leave this
   `null` — the snapshot only matters for set-runs, which is what the drill-down page reads.
3. **Contracts**: add `system_prompt_snapshot: z.string().nullable()` to `EvalRunRecord` in BOTH
   `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts`
   (keep them byte-identical, the established dual-copy discipline).
4. **Promote shared helpers to `client/src/lib/eval-runs.ts`** (or similar shared location — your
   call on exact filename): move `RunGroup`, `groupRuns()`, `caseTransitions()` out of
   `EvalsTab/helpers.ts` into the shared location, update `EvalsTab.tsx`'s import. This is the
   `react-ui-architecture` "promote on second user" pattern already used for `EvalCaseModal` (T13) —
   the new drill-down page becomes the second consumer.
5. **New route** `client/src/app/eval-dashboard/[agentId]/page.tsx` (thin, delegates) →
   `_components/EvalAgentDashboardView/EvalAgentDashboardView.tsx`. Fetch the agent via the existing
   `useAgent(agentId)` hook (name/model) and its run history via the existing
   `useEvalRunHistory(agentId)` hook, grouped with the now-shared `groupRuns()`. Render:
   - Breadcrumb `Skills Lab > Eval Dashboard > {agent name}` via `AppShell`'s `crumb` prop.
   - 3 metric cards (RECALL/PRECISION/CITATION), each showing the latest value + a delta vs the
     previous run + a mini `Sparkline` (reuse the T14 pattern/colors from
     `client/src/app/eval-dashboard/_components/EvalDashboardView/styles.ts`'s `METRIC_COLOR` —
     don't invent a new palette).
   - An insight banner, rendered ONLY when at least one metric dropped between the two newest runs.
     Generation rule is fully specified in the spec's T15 entry — implement it as a pure function in
     the same helpers file, unit-testable without rendering.
   - A full `LineChart` (`@devdigest/ui`, already used elsewhere) with 3 series (recall/precision/
     citation) across the run history, oldest→newest (reverse of the newest-first order the history
     data comes in).
   - A run-history table with checkboxes capped at exactly 2 selections (reuse the same
     "select 3rd drops the oldest" logic already in `EvalsTab.tsx` — extract it too if it's not
     already in the promoted shared helpers) and a "Compare" button, enabled only when exactly 2 are
     selected.
6. **`EvalDashboardView.tsx`** (T14, workspace-level list): change the card's `onClick` to navigate to
   `/eval-dashboard/${a.agent_id}` instead of `/agents/${a.agent_id}?tab=evals`. Don't touch anything
   else about that page's already-reviewed T14 behavior.
7. **`CompareRunsModal`** component (new, location — either the shared eval-runs lib's own
   `_components/` or the new page's own `_components/`, your call): given two `RunGroup`s (old, new),
   render metric deltas (recall/precision/citation/cost, arrows), and a simple line-level text diff of
   `system_prompt_snapshot` between the two groups (hand-roll — no new npm dependency, `client` has no
   `diff`/`jsdiff` package and this is a one-off comparison, not a general-purpose diff viewer; a
   naive "lines only in old = removed, lines only in new = added, common lines = unchanged" heuristic
   is enough, this doesn't need Myers-diff quality). A "Promote v{N}" button per side (or just for the
   newer side, matching the mockup) calls the EXISTING `useUpdateAgent()` mutation
   (`client/src/lib/hooks/agents.ts:69`) with `{system_prompt: run.system_prompt_snapshot}` — no new
   server route. Handle `system_prompt_snapshot === null` gracefully (older runs from before this
   migration won't have one — show "not captured for this run" instead of crashing).
8. **Tests**: new `EvalAgentDashboardView.test.tsx` (metric cards + delta + sparkline render; banner
   renders when a metric dropped and is ABSENT when none dropped; selecting exactly 2 runs enables
   Compare), new `CompareRunsModal.test.tsx` (diff renders added/removed/unchanged lines correctly;
   Promote calls the update mutation with the right snapshot; null snapshot doesn't crash), and extend
   `server/test/evals.it.test.ts` (a bulk run's rows all carry `system_prompt_snapshot` equal to the
   agent's prompt at run time).

### Explicit non-goal for T15

Do not build any "staged/draft prompt, not yet live" concept — "Promote" is a direct, immediate write
to `agents.system_prompt` via the existing update path, not a new versioning/approval workflow. Do not
touch T8's `EvalsTab` two-run comparison UI beyond extracting its helpers to the shared location (the
UI itself, AC-18/AC-19, stays as-is — this is a second, richer surface for the same underlying data,
not a replacement).
