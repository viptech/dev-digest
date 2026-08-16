# PR Brief (L05 feature, pulled forward) on top of Blast Radius (L04)

> This is the **approved implementation plan**, saved for reference before
> execution — not a retrospective record. Source: `.claude/plans/mellow-humming-wolf.md`.
> A Ukrainian translation lives alongside this file:
> `2026-08-07-pr-brief-plan.uk.md`.

## Context

The mockup provided for the Overview page shows three things beyond the
already-shipped Blast Radius: (1) a top "PR BRIEF" card — verdict, findings/
blockers count, a synthesized prose paragraph, a circular PR-score gauge, and
a cost/token line; (2) a two-column grid where the existing Intent card gains
a "Risk Areas" section and sits beside the existing Blast Radius card
(currently both are just stacked full-width); (3) a "Prior PRs touching these
files" footer inside the Blast Radius card. This is explicitly the course's
**L05** scope (root `README.md:86`: "PR Brief card"), not L04 — the user has
decided to pull it forward and build it now.

Two decisions the user made explicitly, after seeing the tradeoffs:

1. **Risk Areas + the prose summary are LLM-generated** (option A) — via the
   `risk_brief` FeatureModelId, which is already registered in
   `server/src/vendor/shared/contracts/platform.ts`'s `FEATURE_MODELS`
   registry ("Assesses merge risks for a pull request", default
   `openai/gpt-4.1`) but has **zero callers anywhere** — this plan adds the
   first one. This is a real, cached, request-time LLM call, not a
   heuristic — it needs the same injection-hardening discipline every other
   LLM call in this codebase already has.
2. **"Prior PRs touching these files" ships now** too — a deterministic SQL
   self-join, no LLM.

**What stays deterministic, and why (do not let this drift toward "the model
decides"):** the PR-level **verdict**, **score**, and **blockers/findings
counts** are computed from already-persisted, already-gate-correct data
(`agent_runs.blockers`, findings counts), never from an LLM. This mirrors a
decision this codebase already made once: `reviewer-core/src/review/reduce.ts`
and `to-review.ts` already override a model's *self-reported* verdict/score
with deterministic recomputation from grounded findings, specifically because
self-reported values "drift and surprise." Laundering that same kind of
self-report into a *cross-agent* PR-level badge would reintroduce the exact
problem the codebase already solved once. Only the **prose narrative** and
the **itemized risk chips** — qualitative, non-gating — go through the new
LLM call.

## Backend: new `server/src/modules/brief/` module

Mirrors `blast/`'s shape (`routes.ts` + `service.ts`), plus a `repository.ts`
this time (needed for the LLM-result cache) and a `risk-brief.ts` for the
prompt/LLM call, kept separate from `service.ts` for testability.

### 1. Deterministic review rollup (no LLM)

**Source**: `container.reviewRepo.reviewsForPull(prId)` (existing method,
`server/src/modules/reviews/repository/review.repo.ts`), filtered to
`kind==='review'`, **deduped to latest-per-agent** (new, small, pure
function — sort newest-first (already the query's order), keep first row per
`agentId`; a review with `agentId===null` never merges with another). This
generalizes the exact "newest-first, first-seen-wins" pattern already used
PR-globally at `server/src/modules/pulls/routes.ts:135-138`, just keyed by
`agentId` instead of `prId`.

For each surviving review, join its `agent_runs` row (via `review.runId`) for
`blockers`, `findingsCount`, `tokensIn`, `tokensOut`.

- **Verdict**: `blockers_total > 0 → request_changes`; else
  `findings_total > 0 → comment`; else `approve`. (`blockers_total`/
  `findings_total` = sum of the latest-per-agent set's `blockers`/
  `findingsCount`.) This mirrors `reviewer-core/src/output/to-review.ts`'s own
  per-run event derivation, generalized across agents — never reads
  `reviews.verdict` (that column is the model's own self-report, per
  `reduce.ts`, and is explicitly not to be trusted for this).
- **Score**: the **lowest score** among the latest-per-agent set (tie-break:
  most recent `createdAt`). Deliberately not an average (would hide one
  agent's failure behind others' clean scores) and not "latest run" (that's
  what the existing PR-list `score` field already does — leave that field
  alone; the Brief's score is allowed to differ from the list's, and that
  should get a one-line code comment so it doesn't look like an accidental
  inconsistency later).
- **Blockers/findings totals**: straight sums of each survivor's
  already-persisted `agent_runs.blockers`/`findingsCount` — not a fresh
  pooled recompute (that would need each finding's *originating* agent's own
  `ci_fail_on`, which the per-run column already correctly encodes).
  Cross-agent duplicate findings are not deduped — consistent with how
  `page.tsx` already computes the site-wide findings badge today
  (`runs.flatMap(r => r.findings).length`).
- **Cost/tokens**: a **different, wider** row-set than the above — every
  `agent_runs` row ever for the PR (mirrors the existing `cost_usd` sum at
  `pulls/routes.ts:159-173`, whose own comment says "every review pass, not
  just latest" — money was spent on discarded reruns too). Extend that exact
  query block with `sum(tokensIn)`/`sum(tokensOut)`. Comment clearly that
  cost/tokens and blockers/findings intentionally read from two different
  row-sets, so nobody "simplifies" them into one query later and silently
  changes a number's meaning.
- **Null case**: zero `kind==='review'` rows → `review_rollup: null` (mirrors
  `PrIntentRecord | null`). Risks/prior-PRs are still computed regardless.

New pure file: `server/src/modules/brief/rollup.ts` (`latestReviewPerAgent`,
`computeVerdict`, `pickLowestScore`) — no I/O, fixture-testable.

### 2. Risk Areas + summary — the new LLM call

**New file `server/src/modules/brief/risk-brief.ts`**, structured exactly
like `server/src/modules/reviews/intent-service.ts`'s `classify()` (same
cache-check → resolve-model → build-prompt → `completeStructured` →
persist shape) — that file is the direct precedent for "a feature-specific
LLM classifier that isn't a full agent review," not `reviewPullRequest`.

- **Cache**: extend the existing (currently-dead) `pr_brief` table
  (`server/src/db/schema/reviews.ts:67-71`, today just `{pr_id PK, json}`)
  with the same staleness-cache columns `pr_intent` already has one table
  above it in the same file: `headSha`, `providerUsed`, `modelUsed`,
  `createdAt`. **New migration required** (`pnpm db:generate` after the
  schema change — this is the sanctioned way per root `CLAUDE.md`: "never
  edit an applied migration; change `db/schema.ts` and generate a new one").
  `json` stores `{summary: string, risks: Risk[]}` — only the LLM-generated
  half of the brief; the deterministic rollup and prior-PRs are always
  computed live, never cached, matching Blast Radius's own "no cache" choice
  for its (cheaper) computation.
- **Cache check**: `cached.headSha === pull.headSha` → return cached
  `{summary, risks}` with zero LLM calls, exactly like
  `IntentClassificationService.classify()`'s early-return branch.
- **Model resolution**: `resolveFeatureModel(container, workspaceId,
  'risk_brief')` (already exists, zero current callers) → `container.llm(provider)`.
- **Prompt — properly injection-hardened, stricter than `intent-service.ts`'s
  own precedent** (that file doesn't wrap its PR title/description in
  `wrapUntrusted()`, which is a pre-existing gap in this codebase — not
  fixing that file here, but not repeating the gap in new code, especially
  for a *risk-assessment* feature, the exact target of the "claims this is a
  test fixture, ignore it" injection pattern `INJECTION_GUARD` itself warns
  about):
  - Trusted system prompt: instructs the model to (a) write one short
    paragraph synthesizing the PR's most important concerns, consistent with
    the blockers/score numbers given, and (b) list 0-N structured risks
    (`kind`, `title`, `explanation`, `severity`, `file_refs` — reuse the
    `Risk` zod schema from `brief.ts` directly as the structured-output
    schema, it already fits). Append `INJECTION_GUARD` (imported from
    `@devdigest/reviewer-core`) to this system prompt — same primitive every
    review agent's prompt already gets via `assemblePrompt`.
  - Trusted context block (built by us, not LLM-guessed): PR title, the
    deterministic verdict/score/blockers numbers from §1, and each surviving
    review's own title/severity findings summary (aggregated counts, not full
    rationale) — so the model's paragraph can't contradict the badge shown
    next to it.
  - Untrusted block, wrapped via `wrapUntrusted('pr-description', pull.body)`
    and `wrapUntrusted('diff', <hunk headers, same MAX_HUNK_HEADER_FILES-style
    cap as intent-service.ts's formatHunkHeaders>)`.
- **Grounding-equivalent for `Risk.file_refs`** (needed because
  `groundFindings` in `reviewer-core/src/grounding.ts` only type-checks
  against line-ranged findings, not plain-path `file_refs` — do not try to
  force-fit it): after `completeStructured` returns, filter each risk's
  `file_refs` down to paths that are actually in the PR's changed files
  (`pr_files`); if a risk's `file_refs` becomes empty after filtering, drop
  the whole risk (the model claimed impact on files outside this diff — an
  ungrounded claim). New pure function `groundRisks(risks, changedPaths)` in
  `risk-brief.ts`, unit-tested directly (not reusing `groundFindings`).
- **Persist**: `repo.upsertPrBriefCache(prId, {summary, risks}, {providerUsed,
  modelUsed, headSha: pull.headSha})` after grounding — cache the grounded
  result, not the raw model output.
- **Failure handling**: like `intent-service.ts`'s own doc comment says of
  itself, a risk-brief failure must never block the rest of the Overview tab
  — `brief/service.ts` wraps the call in try/catch and returns `risks: [],
  summary: null` with a `degraded`-style flag on failure (mirrors Blast
  Radius's own `degraded`/`reason` pattern already shipped) rather than
  failing the whole `GET /pulls/:id/brief` request.

### 3. "Prior PRs touching these files"

Reuse `PrHistoryItem`/`PrHistory` from `brief.ts:90-103` (`{pr_number, title,
merged_at, author, files_overlap, notes}`), with `notes: ''` always (no LLM
here). `pull_requests` has no `merged_at` column — use `updated_at` as the
proxy and exclude rows where it's null rather than fabricate a value.

Query shape (matches this codebase's "fetch small row-sets, group in JS"
style already used at `pulls/routes.ts:141-157,163-173`, not a heavy SQL
join): current PR's `pr_files.path` list → all `pr_files` rows sharing those
paths elsewhere → group by `pr_id` in JS, drop the current PR, join against
`pull_requests` filtered to `repo_id` + `status='merged'`, sort by
`updated_at desc`, cap at 10 with an accurate uncapped `prior_prs_count`.
Lives in `brief/repository.ts`/`brief/service.ts` — not bolted onto
`BlastRadius`'s own contract (keeps Blast conceptually call-graph-only) and
not a third network fetch (one `GET /pulls/:id/brief` covers rollup + risks +
prior-PRs, same "one fetch per Overview-tab concern" shape `useBlastRadius`/
`useIntent` already each have).

### 4. Route + registration

- `server/src/modules/brief/routes.ts` — `GET /pulls/:id/brief`, same
  `IdParams` + `getContext` + PR-lookup-then-404 pattern as `blast/routes.ts`.
- `server/src/modules/brief/service.ts` — orchestrates §1 (sync/pure) + §2
  (async, cached, try/caught) + §3 (async) into one `PrBriefSnapshot`.
- Register in `server/src/modules/index.ts` (one import + one entry) — that
  file's own doc comment already lists "brief" by name as an anticipated
  module.
- No DB access in `routes.ts` beyond the PR/repo lookup, same as
  `blast/routes.ts` — service resolves `container.reviewRepo`/`container.llm`/
  `container.repoIntel`, never constructs a concrete repository/service class
  directly (onion-architecture rule already enforced by every sibling module).

### 5. Wire contract (both vendor copies — server AND client, hand-synced, no symlink)

```ts
export const PrBriefReviewRollup = z.object({
  verdict: Verdict,
  score: z.number().int(),
  findings_count: z.number().int(),
  blockers_count: z.number().int(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
});
export const PrBriefSnapshot = z.object({
  review_rollup: PrBriefReviewRollup.nullable(),
  summary: z.string().nullable(),      // LLM-generated, null on cold/failed cache
  risks: z.array(Risk),                // LLM-generated, grounded
  degraded: z.boolean().optional(),    // risk-brief LLM call failed/unavailable
  prior_prs: z.array(PrHistoryItem),
  prior_prs_count: z.number().int(),
});
```
(Named `PrBriefSnapshot`, not `PrBrief` — `brief.ts` already reserves
`PrBrief = {intent, blast, risks, history}` for a different, larger future
composite; reusing that name here would collide.) `Risk`/`PrHistoryItem`
reused unchanged from `brief.ts`. `PrMeta`/`PrDetail` on `platform.ts` are
untouched — Brief data is its own fetch, not embedded into `PrDetail`.

### 6. Migration

`server/src/db/schema/reviews.ts`'s `prBrief` table gains `headSha`,
`providerUsed`, `modelUsed`, `createdAt` (identical shape to the `prIntent`
table directly above it in the same file). Run `pnpm db:generate` to produce
the new numbered migration — do not hand-write it, do not touch any existing
`0NNN_*.sql` file.

## Client

### 7. `useBrief` hook + wiring

`client/src/lib/hooks/brief.ts` (new, own file — not a "review" concept, same
rationale `hooks/blast.ts` already documents for itself), exact template of
`useBlastRadius`: `useQuery({queryKey:["brief",prId], queryFn:()=>
api.get<PrBriefSnapshot>(`/pulls/${prId}/brief`), enabled:!!prId})`.

### 8. Restructure `IntentCard` → `IntentAndRiskCard`, and `BlastRadiusCard`'s header

Both cards currently use `<section><SectionLabel/><div style={s.card}>...</div></section>`
— the label sits **outside** the bordered box. The mockup wants the header
**inside** the same border as the content. Fix identically in both:
`<section><div style={s.card}><div style={s.headerRow}><SectionLabel .../></div><div style={s.divider}/>...content...</div></section>`.
`SectionLabel` (`client/src/vendor/ui/primitives/SectionLabel.tsx`) hardcodes
`marginBottom:14` with no override prop today — add one optional `noMargin?:
boolean` prop (one-line change) so it can sit flush inside a padded header
row without doubled spacing. Add `s.headerRow`/`s.divider` to each card's
`styles.ts` (a `divider` = `borderTop: '1px solid var(--border)'`, same idea
`BlastRadiusCard`'s own `groupBody.borderTop` already uses one level down).

Rename `IntentCard` → `IntentAndRiskCard` (folder + files) since it becomes a
single bordered card with two internal sections (Intent, then a divider, then
Risk Areas) rather than a single-purpose card — matches how `BlastRadiusCard`
already composes multiple internal sections (banner/body) inside one `s.card`.
Risk Areas renders `brief.risks` as `Badge`s (reuse the primitive already
imported in the current `IntentCard.tsx`), colored by `severity` (`high→
var(--crit)`, `medium→var(--warn)`, `low→var(--info)`, all already-used CSS
vars). Empty state and section label text reuse the **already-provisioned**
`client/messages/en/brief.json` keys (`block.risks: "Risks"`, `noRisks`, etc.
— confirmed present, auto-loaded by `client/src/i18n/request.ts`, just needs
`useTranslations("brief")`, no new i18n wiring).

`BlastRadiusCard.tsx` gets the same header-inside-border fix, plus a new
footer section after its existing body: "Prior PRs touching these files
[{count}]" with a chevron, expand-on-click rendering `prior_prs` entries
(number/title/author/updated_at/files_overlap chips) — reuses `brief.json`'s
already-present `block.history`/`noHistory`/`overlap` keys.

### 9. New `PrBriefCard`

`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/{PrBriefCard.tsx,styles.ts,index.ts,PrBriefCard.test.tsx}`
— all-reused building blocks, nothing new to build visually:
- Verdict badge: `VERDICT_META[verdict]` + icon, same mapping
  `VerdictBanner.tsx` already uses (`.../VerdictBanner/constants.ts`).
- Score gauge: `<CircularScore score={score} size={52} stroke={5}/>`
  (`client/src/vendor/ui/primitives/CircularScore.tsx`) — already exactly the
  "ring + big number + caption" shape, already used at this exact size in
  `VerdictBanner.tsx`. Do not build a new gauge.
- Cost/token line: `<RunCostBadge costUsd={...} tokensIn={...}
  tokensOut={...} variant="detailed" tokenFormat="pair"/>`
  (`client/src/components/run-cost-badge/RunCostBadge.tsx`) — already formats
  exactly `$0.014` / `8.2K→1.3K`; already null-safe when tokens are absent.
- Prose summary + findings/blockers count: plain text from
  `brief.review_rollup`/`brief.summary`.
- Renders nothing (`return null`) when `review_rollup` is `null`, matching
  `BlastRadiusCard`'s own established convention for "nothing to show yet."

### 10. Two-column grid

No existing precedent for a fixed 2-column named-section grid anywhere in
`client/src/app` (every existing `display:grid` is an N-item auto-fill list).
Add to `OverviewTab/styles.ts`:
```ts
twoColGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
```
Check `client/src/app/globals.css` for an existing breakpoint token before
adding a narrow-viewport fallback; if none exists, keep it simple — a plain
`@media` rule isn't expressible through this codebase's inline-style-object
convention, so don't invent a CSS-module just for this one grid. A reasonable
minimal fallback: skip responsive collapsing for this pass (the PR detail
page already assumes a `maxWidth:1080` desktop-ish container everywhere else
in `page.tsx`) unless a quick look at `globals.css` turns up an existing
pattern worth matching.

`OverviewTab.tsx`: call `useBrief(prId)` once, render `<PrBriefCard
rollup={brief?.review_rollup} summary={brief?.summary}
degraded={brief?.degraded}/>` above the grid, then the grid with
`<IntentAndRiskCard intent={intent} risks={brief?.risks}/>` (left) and
`<BlastRadiusCard ... priorPrs={brief?.prior_prs}
priorPrsCount={brief?.prior_prs_count}/>` (right).

### 11. Demo data

`server/src/db/seed.ts` currently seeds PR #482's files as
`src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`, `src/config.ts`,
`src/api/users.ts` — none of which trip the auth-pattern or new-dependency
signals a real risk-brief LLM call would plausibly surface on its own, and
there's no `package.json` row at all. Add a `package.json` file row (patch
adding `ioredis`) and confirm at least one path matches an auth-ish pattern,
so the live demo actually has something for the LLM to find and for
`groundRisks` to keep. This is ordinary seed-data editing, not a migration.

## Tests

- `server/src/modules/brief/rollup.test.ts` — `latestReviewPerAgent` (dedup
  by agentId, newest-first), `computeVerdict` (blockers>0/findings>0/none),
  `pickLowestScore` (tie-break by recency), and an explicit test proving
  cost/tokens (all-runs) and blockers/findings (latest-per-agent) diverge for
  an agent re-run twice — locks in the deliberate two-row-set split.
- `server/src/modules/brief/risk-brief.test.ts` — cache hit (fresh `headSha`,
  zero LLM calls, mirrors `intent-service`'s own tested shape if one exists,
  else write fresh), cache miss → calls `completeStructured` with a fake
  `LLMProvider`, `groundRisks` (drops a risk whose every `file_refs` entry is
  outside the PR's changed files; keeps a risk with at least one valid ref,
  filtering out the invalid ones), and a failure path (LLM throws →
  `degraded:true`, no request-level failure).
- `server/src/modules/brief/prior-prs.test.ts` — overlap grouping,
  current-PR exclusion, merged-only filter, cap-at-10 with accurate
  `prior_prs_count`, null-`updated_at` rows excluded.
- `server/test/brief.it.test.ts` (integration, Docker-gated) — the actual
  self-join query against seeded `pr_files`, and the migration's new columns
  round-tripping through a real Postgres.
- Client: `PrBriefCard.test.tsx` (mirrors `BlastRadiusCard.test.tsx`'s mocking
  pattern), `IntentAndRiskCard.test.tsx` (new — no prior `IntentCard` test
  existed), extend `BlastRadiusCard.test.tsx` with the new prior-PRs footer.

## Do-not-touch / architecture check

- **Migration**: one new migration, generated via `pnpm db:generate` from a
  `db/schema.ts` change — the sanctioned path, no hand-written SQL, no edit
  to any already-applied migration file.
- **Injection guard**: the new risk-brief prompt is the first place in this
  plan that touches untrusted PR text directly — `wrapUntrusted()` +
  `INJECTION_GUARD` (both already exported from `@devdigest/reviewer-core`)
  are used explicitly, deliberately more rigorously than `intent-service.ts`'s
  own existing (weaker) precedent, not less.
- **Grounding gate**: `reviewer-core/src/grounding.ts`'s `groundFindings` is
  untouched — it doesn't apply to `Risk` (no line ranges), so a new, separate
  `groundRisks` is written rather than force-fitting or weakening the
  existing gate.
- **`risk_brief` FeatureModelId**: this plan is its first real caller — not a
  repurposing, exactly the slot's stated intent.
- **`pr_brief` table**: extended (new columns via migration), not replaced or
  reinterpreted — still PK'd by `pr_id`, still owned by the new `brief`
  module's own `repository.ts`.
- **Onion boundaries**: `brief/service.ts` resolves `container.reviewRepo` /
  `container.llm` / `container.repoIntel` via the DI container only, same
  discipline `BlastService` already follows.

## Verification

1. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — new unit
   tests pass.
2. `cd server && pnpm exec vitest run .it.test` (Docker up) —
   `brief.it.test.ts` passes, migration applies cleanly on a fresh test DB.
3. `cd server && pnpm typecheck` / `cd client && pnpm typecheck`.
4. `cd server && pnpm db:generate` then `pnpm db:migrate` locally, confirm the
   new columns exist (`\d pr_brief` or equivalent) before writing code against
   them.
5. `./scripts/dev.sh`, open PR #482 (after the seed-data addition), confirm:
   PR Brief card renders verdict/score/blockers/cost-tokens; a first load
   triggers one real risk-brief LLM call (check server logs / cost), a
   second load of the same PR is a cache hit (no new LLM call, same
   `head_sha`); Risk Areas chips render inside the Intent card with a
   divider; Blast Radius card's header now sits inside its border and shows
   a working Prior-PRs footer; the whole Overview tab is a two-column grid
   below the PR Brief card.
6. `cd client && pnpm test` — full client suite green, including the new/
   renamed component tests.
