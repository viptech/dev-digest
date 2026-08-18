# Development Plan — Smart Diff

## Context

Today `GET /pulls/:id` returns `files: PrFile[]` (`path`/`additions`/
`deletions`/`patch`) in whatever order GitHub/`t.prFiles` happens to store
them, and the client's `DiffTab` (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`)
renders them straight through `<DiffViewer files={files} .../>` with no
grouping. A reviewer opening a large PR has to scroll past `package-lock.json`
and generated boilerplate to find the one file that actually matters, and,
after running a review, has no way to jump from a finding straight to its
line — findings only surface inside the separate review UI, not inline in the
diff.

Smart Diff groups the PR's already-imported files by **risk role** — `core`
(business logic), `wiring` (config/index/glue), `boilerplate` (lock files,
`dist/`, snapshots) — so the reviewer sees core logic first and boilerplate
collapsed by default. It is **not** a new LLM feature: it deterministically
combines two sources that already exist in the database —

1. `t.prFiles` (`path`, `additions`, `deletions`, `patch`) — already persisted
   by `GET /pulls/:id` (`server/src/modules/pulls/routes.ts:234-245` on the
   GitHub-refresh path, `routes.ts:273` on the offline-fallback path).
2. The **latest** review's findings (`file`, `start_line`/`end_line`,
   `severity`) — already persisted in `t.reviews`/`t.findings` and already
   queried this exact way (latest-per-PR via `kind: 'review'` +
   `orderBy(desc(createdAt))`, first-seen-wins) at
   `server/src/modules/pulls/routes.ts:130-139`.

The response contract already exists, unwired: `SmartDiff`/`SmartDiffGroup`/
`SmartDiffFile`/`ProposedSplit` in
`server/src/vendor/shared/contracts/brief.ts:93-126` (mirrored in
`client/src/vendor/shared/contracts/brief.ts`), confirmed identical between
server and client copies this session. Classification runs the moment files
are available (right after PR import — "does not call the model"); findings
are joined in whenever they exist. **Nothing here is unwired scaffolding to
verify** the way Intent Layer's `pr_intent` table was — `SmartDiff` has zero
callers today (grep confirms), it must be built from scratch, only the shape
is pre-defined.

## Modules involved

- **server** — new deterministic file classifier (pure function, no I/O), a
  new route `GET /pulls/:id/smart-diff`, and (small) data-access additions to
  read the latest review's findings for a PR.
- **shared contracts** (`server/src/vendor/shared` + the hand-duplicated
  `client/src/vendor/shared` copy) — `SmartDiff` already exists on both sides;
  this plan needs no *new* fields there, but see the `pseudocode_summary`
  decision under Constraints.
- **client** — a new `SmartDiffViewer` (or a `SmartDiffTab`/mode toggle on the
  existing `DiffTab`) that groups files by role, keeps `boilerplate` collapsed,
  shows an "N findings" badge per file, and scrolls the diff to a clicked
  finding's line.
- **reviewer-core** — out of scope. Smart Diff never touches the review
  prompt or `assemblePrompt`; it only reads *outputs* of a review
  (`findings`), never feeds anything back into a review input.
- **e2e** — out of scope per `TESTING.md` (deterministic-only e2e; Smart Diff
  has no LLM step to need hermetic mocking beyond what the diff/review fixtures
  already provide, but a smoke check could be added later — not required by
  this plan).

## Constraints

- **No new LLM call, anywhere in this feature.** This is the load-bearing
  acceptance criterion ("У логах перегляду Smart Diff немає нового виклику
  моделі"). The classifier must never import `resolveFeatureModel`
  (`server/src/modules/settings/feature-models.ts`) or call
  `container.llm(...)` (`server/src/platform/container.ts:163`) — the single
  chokepoint for model access in this repo. Concretely verifiable: `grep -n
  "container.llm(\|resolveFeatureModel(" server/src/modules/smart-diff/` (or
  wherever the classifier lands) must return nothing.
- **`SmartDiffFile.pseudocode_summary`** (`brief.ts:99`, `z.string().nullish()`)
  was evidently designed with a future LLM-summarization step in mind. This
  plan's classifier does **not** populate it — every `SmartDiffFile` must set
  it to `null`, never fabricate a summary. State this explicitly in the
  implementer's PR description so it reads as a deliberate scope decision, not
  a bug or an oversight.
- **Wire contracts are snake_case, server+client copies must be kept in sync
  by hand** (root `CLAUDE.md`; the same `Intent`-field-drift incident recorded
  in root `INSIGHTS.md`, 2026-07-31, is the reason this matters). `SmartDiff`
  already exists identically on both sides — if this plan's route/response
  shape needs *any* adjustment to the contract (e.g. it turns out
  `finding_lines` needs a `severity` alongside the line number — see Ordered
  steps below), edit both `server/src/vendor/shared/contracts/brief.ts` and
  `client/src/vendor/shared/contracts/brief.ts` in the same step.
- **Module shape** (`server/CLAUDE.md`): `modules/<name>/` =
  `routes.ts` + `service.ts` + `repository.ts` (split into
  `repository/<entity>.repo.ts` once data access grows). The `pulls` module
  itself is an exception — it has no `repository.ts`, it reads
  `container.db` + `t.prFiles`/`t.pullRequests` directly
  (`server/src/modules/pulls/routes.ts`) — confirmed by re-reading the file
  this session; **do not copy that exception** for new code, follow the
  standard three-file shape for wherever Smart Diff's route lives.
- **DB naming**: snake_case SQL / camelCase Drizzle, per root `CLAUDE.md`.
  Smart Diff needs **no new table** — it is computed on read from
  `t.prFiles` + `t.reviews`/`t.findings`, the same "no FK denorm, cheap
  IN-queries + JS grouping" pattern already used for the PR list's
  score/findings columns (`pulls/routes.ts:123-157`).
- **Migrations**: not applicable — no schema change in this plan.
- **The grounding gate** (`reviewer-core/src/grounding.ts`) and **the injection
  guard** (`reviewer-core/src/prompt.ts`) are both untouched by this feature —
  Smart Diff never assembles a prompt or produces a finding; it only
  re-displays findings a review already produced and grounded.
- **Best-effort join pattern already established for exactly this shape of
  problem**: `pulls/routes.ts:222` (`container.reviewRepo.getIntent(pr.id).catch(() => undefined)`)
  is the precedent to follow — Smart Diff's findings lookup should degrade to
  an empty `finding_lines: []` per file (not fail the whole request) when no
  review has run yet, matching the plan's own "До рев'ю сортування працює без
  накладок" requirement.

## Skills the implementer will use

- **`onion-architecture`** — the classifier is pure domain logic (path/pattern
  matching, zero I/O) and must not reach into adapters directly; the route
  layer stays a thin HTTP↔service translator, following the same
  `routes.ts`→`service.ts`→`repository.ts` shape `server/CLAUDE.md` documents
  (rather than the `pulls` module's grandfathered exception).
- **`zod`** — reusing the existing `SmartDiff`/`SmartDiffGroup`/`SmartDiffFile`/
  `ProposedSplit` schemas (`brief.ts:93-126`); if any field needs adjusting,
  follow this repo's safe-parse conventions already used elsewhere
  (`feature-models.ts:46`).
- **`fastify-best-practices`** — the new `GET /pulls/:id/smart-diff` route
  must follow this repo's existing zod-schema-per-route convention
  (`server/src/modules/reviews/routes.ts`, `server/src/modules/pulls/routes.ts`).
- **`drizzle-orm-patterns`** — the findings-join query (latest review per PR,
  `kind: 'review'`, `orderBy(desc(createdAt))`, first-seen-wins, then
  `inArray(t.findings.reviewId, ...)`) mirrors `pulls/routes.ts:130-157`
  almost exactly; no new table, but a repository method needs the same
  IN-query shape.
- **`react-ui-architecture`** / **`react-best-practices`** — deciding whether
  `SmartDiffViewer` is a new top-level tab, a mode toggle inside the existing
  `DiffTab`, or a new `_components/SmartDiffViewer/` feature folder (following
  the `IntentCard` pattern: `SmartDiffViewer.tsx` + `index.ts` + `styles.ts` +
  possibly `constants.ts` for role labels/colors) — and wiring the
  scroll-to-line behavior into the existing `@/components/diff-viewer`
  (`FileCard`/`CodeLine` subcomponents) rather than re-implementing diff
  rendering.
- `engineering-insights` is not for the planner to invoke — the implementer
  records it at the end of its own work per the repo's session protocol.

## Ordered steps

### 1. File classifier (pure, constants-driven)

- New pure function, e.g. `classifyFile(path: string): SmartDiffRole`, with
  **all thresholds and patterns extracted into a dedicated constants file**
  (explicit acceptance criterion: "Пороги й патерни винесені в константи") —
  e.g. `server/src/modules/smart-diff/classification-rules.ts` (or colocated
  under wherever the module lands), never inline regex literals in the
  classifier body.
- Rule shape (deterministic, evaluated path-only — `additions`/`deletions`
  never affect role, only display):
  - **`boilerplate`** — lock files (`package-lock.json`, `pnpm-lock.yaml`,
    `yarn.lock`), build output (`dist/`, `build/`, `.next/`), snapshots
    (`__snapshots__/`, `*.snap`), and other purely generated artifacts. Must
    be unconditional and highest-priority in the match order — the plan's own
    acceptance criterion is "Lock-файл завжди класифікується як boilerplate"
    (no override, no exception).
  - **`wiring`** — config files (`*.config.*`, `.env*`, `tsconfig*.json`),
    barrel/index files (`index.ts`, `index.tsx`) matching this repo's own
    "translate at the boundary" route-file convention, and DI/registration
    files.
  - **`core`** — everything else (default/fallback role — business logic is
    the "didn't match a more specific pattern" case, not a positive pattern
    list of its own, since business logic can't be pattern-matched
    exhaustively by path).
  - Match order matters: boilerplate patterns checked first (most specific,
    must never be shadowed), then wiring, else core.
- Unit-testable in complete isolation — no `Container`, no DB — this is the
  natural first slice for TDD.

### 2. Route: `GET /pulls/:id/smart-diff`

- New module (or extend `pulls` only if the implementer's onion-architecture
  read prefers colocating with `PrDetail` — but prefer a small dedicated
  `modules/smart-diff/` following the standard three-file shape over growing
  the already-nonstandard `pulls` module further).
- **Inputs** (both already available, no new external call):
  - `t.prFiles` rows for the PR (`path`/`additions`/`deletions`/`patch` —
    `patch` not needed for classification itself, only `additions`/
    `deletions` roll into `SmartDiffFile.additions`/`deletions`).
  - Latest review's findings for the PR, via a new repository method
    mirroring `pulls/routes.ts:130-157`'s exact query shape: reviews for this
    PR filtered to `kind: 'review'`, `orderBy(desc(createdAt))`, take the
    first (latest); then `findings` for that one review's id via
    `inArray(t.findings.reviewId, [latestReviewId])`. **Best-effort**: if no
    review has ever run, this must degrade to `[]`, never throw or 404 the
    whole Smart Diff response (mirrors the `getIntent(...).catch(() =>
    undefined)` precedent at `pulls/routes.ts:222`).
- **Assembly**: group `prFiles` by `classifyFile(path)` into
  `SmartDiffGroup[]`; for each file, set `finding_lines` to the sorted list of
  that file's findings' `start_line` values (using `start_line` since
  `Finding` has no single `line` field — `findings.ts:47-73` — confirm with
  the implementer whether `start_line` alone is sufficient or the badge should
  cover the full `start_line`..`end_line` range; this plan recommends
  `start_line` as the scroll target, `end_line` only if the UI wants to
  highlight a range).
- **`split_suggestion`**: deterministic threshold check, no LLM — e.g.
  `too_big: total_lines > SPLIT_THRESHOLD_LINES` (a constant, per step 1's
  "extract thresholds" rule), `total_lines` = sum of all files'
  `additions+deletions`, `proposed_splits: []` unless a simple, deterministic
  split heuristic is included (e.g. one split per non-boilerplate group) — the
  homework's plan doesn't require a sophisticated split algorithm, only that
  the field is populated per the existing contract shape. Flag this as a
  scope decision for the implementer to state explicitly rather than silently
  picking a heuristic.
- **Response**: `SmartDiff` as already defined
  (`server/src/vendor/shared/contracts/brief.ts:93-126`) — no contract change
  needed unless step's `finding_lines` semantics require adding a severity
  alongside each line (optional enhancement, not required by the acceptance
  criteria as written).

### 3. Client: `SmartDiffViewer`

- New feature folder (mirroring `IntentCard`'s shape:
  `_components/SmartDiffViewer/{SmartDiffViewer.tsx,index.ts,styles.ts}`,
  plus `constants.ts` for role labels/colors/descriptions) fetched via a new
  hook in `client/src/lib/hooks/reviews.ts` (e.g. `useSmartDiff(prId)`,
  mirroring `usePrReviews`/`useRefreshIntent`'s existing query patterns) —
  hitting `GET /pulls/:id/smart-diff`.
- **Layout**, per the homework's reference screenshot (`acme/payments-a…`
  mock, "Files changed" tab, "Smart order" vs "Original order" toggle at the
  top-right):
  - A toggle control (`Smart order` / `Original order`) — smart order groups
    by role; original order falls back to the plain `DiffTab` file list
    (existing behavior, unchanged) — this satisfies "тримайте boilerplate
    згорнутим" only in Smart order mode, and gives an escape hatch back to the
    current experience.
  - Group headers, one per non-empty role, each with a short description
    matching the mock's copy style (`Core logic` — "The substance of the
    change — review closely"; `Wiring` — "Hooks the core into the app";
    `Boilerplate` — "Generated / mechanical — skim") and a file count badge.
  - `core` and `wiring` groups **expanded by default**; `boilerplate`
    **collapsed by default** — this is a literal acceptance criterion, not a
    styling preference.
  - Per-file: a findings badge (`N findings`, only rendered when
    `finding_lines.length > 0`) — **clickable**, scrolling the diff to the
    file and highlighting/jumping to the first (or selected) line in
    `finding_lines`. Reuse `@/components/diff-viewer`'s existing `FileCard`/
    `CodeLine` scroll/highlight primitives rather than re-implementing diff
    rendering — confirm what scroll-to-line hook already exists there (e.g.
    via `usePrComments`'s comment-anchor pattern) before writing a new one.
- Client contract: no new fields needed — `client/src/vendor/shared/contracts/brief.ts`
  already mirrors `SmartDiff` (confirmed identical this session).

### 4. Logging / observability

- No `RunLogger`/SSE integration needed — `GET /pulls/:id/smart-diff` is a
  plain HTTP read, not part of a review run, so it never touches
  `server/src/platform/run-logger.ts` or `RunBus`. This is *how* the
  acceptance criterion "у логах перегляду Smart Diff немає нового виклику
  моделі" is naturally satisfied: there is no review-run context for a model
  call to appear in at all.
- Verify (don't just assume) by: (a) `grep -n "container.llm(\|resolveFeatureModel("`
  over the new module returns nothing; (b) no new `agent_runs` row is ever
  inserted by hitting this endpoint (that table is only written by
  `run-executor.ts`); (c) manually hitting the endpoint against a seeded PR
  and confirming no new pino/stdout line resembling an LLM call appears.

## Test plan

- **server-unit** (`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`):
  - `classifyFile` — table-driven tests: lock files → `boilerplate`
    (unconditionally, including nested paths like `packages/foo/package-lock.json`),
    `dist/`/`__snapshots__/` → `boilerplate`, `*.config.*`/`index.ts` →
    `wiring`, everything else → `core`. This is the natural TDD entry point
    per `superpowers:test-driven-development`.
  - Smart Diff assembly (mock repository layer, no DB): given a fixed set of
    `prFiles` + findings, assert the correct `groups`/`finding_lines`/
    `split_suggestion` shape; assert **zero calls** to any mocked
    `container.llm`/`resolveFeatureModel` (per `server/src/adapters/mocks.ts`'s
    hermetic-by-default convention).
- **server-integration** (`cd server && pnpm exec vitest run .it.test`, needs
  Docker): new `*.it.test.ts` hitting `GET /pulls/:id/smart-diff` against real
  Postgres — (a) before any review has run → all files present, `core`
  first-priority files show `finding_lines: []`; (b) after a review with
  findings exists → the correct files show non-empty `finding_lines` matching
  the seeded findings' `start_line`s; (c) a PR whose files include a lock
  file → that file lands in the `boilerplate` group every time.
- **client** (`cd client && pnpm test` + `pnpm typecheck`): a render test for
  `SmartDiffViewer` — `boilerplate` group starts collapsed, `core`/`wiring`
  start expanded, a findings badge renders only when `finding_lines` is
  non-empty and is clickable, the Smart/Original order toggle switches views.
- **Manual smoke check** (per the homework's own "Як перевірити" section, not
  automatable in this repo's current e2e per `TESTING.md`): open a large
  seeded PR, confirm `core` shows first and the lock file is collapsed; run a
  review and confirm badges appear and clicking one scrolls to the right
  line; check server logs and confirm no new LLM call fired; record three
  short findings in the homework's own notes field.

## Out of scope

- No application file is created or edited by this plan itself — it is a
  design document only, for the implementer to execute against.
- Architecture review and security review are not part of this plan or the
  implementer's job — separate review agents own those passes.
- **A sophisticated `proposed_splits` algorithm** (e.g. dependency-aware file
  clustering) is explicitly out of scope — the acceptance criteria only
  require the `SmartDiff` contract shape to be populated with *some*
  deterministic, documented heuristic; a smarter splitter is a natural
  follow-up, not required here.
- **Populating `SmartDiffFile.pseudocode_summary`** is out of scope (see
  Constraints) — that field stays `null` until/unless a future iteration adds
  a deliberate, separately-scoped LLM-summarization step (which would then
  need its own cost/logging/prompt-injection treatment, same as Intent
  Layer's).
- **Persisting Smart Diff results** (e.g. a `smart_diff` cache table) is not
  required — the classifier is cheap/pure and the findings join is a couple
  of indexed queries, so computing on every `GET` is acceptable; add caching
  only if profiling later shows it's needed.
