# Intent Layer — Implementation Record + Review Results

> This is a **retrospective record**, not a forward-looking task plan like
> the other files in this directory. It documents a feature that was
> implemented this session (uncommitted on `feat/homework-l03` at the time of
> writing), the two amendments applied on top of the original approved plan,
> and the findings from two review passes run against the diff. Every claim
> below was checked against the current file contents, not transcribed from
> the session summary — see file:line citations throughout.

**Source plan:** `.claude/plans/intent-layer.md` (full context, constraints,
ordered steps, test plan).

## Context (from the source plan)

Before this feature, a PR review only ever saw the diff plus the raw PR
description text, verbatim. Nothing separated "what changed" from "why" — the
reviewing agent had to infer motivation itself, on every run, from whatever
the author happened to type, and never looked at the linked issue or a
referenced plan/spec document at all.

The Intent Layer adds one small, cheap, separately-modeled classification
step that runs once per PR (not once per review agent): it reads the PR's
title, description, linked GitHub issue, and any referenced plan/spec, and
produces a short structured `intent` (+ scope + confidence + provenance) that
is then fed into every agent's review prompt alongside the diff. When the
description is thin, it falls back to indirect signals (changed files,
commit messages, branch name, diff stat) and marks the result
`confidence: 'low'` rather than fabricate false certainty.

Two pieces were already unusually far along before this session and were
verified, not rebuilt: the `review_intent` entry in `FEATURE_MODELS`
(already a pickable row in Settings) and the `pr_intent` table +
`upsertIntent`/`getIntent` repository methods (already existed, but had zero
callers).

## Amendments to the source plan

The source plan explicitly left two things open for the implementer/user to
decide. Both were resolved this iteration:

1. **Storage target: `pr_intent`, not `pr_brief`.** The source plan's "Out of
   scope" section flagged a real tension — `Intent` could be persisted either
   into the narrow, already-wired `pr_intent` table or folded into the
   broader `pr_brief` JSON-blob (`PrBrief` contract, composing
   `Intent`+`BlastRadius`+`Risks`+`PrHistory`). Confirmed: `pr_brief` has zero
   application-code readers/writers anywhere in `server/src/modules/**` today
   — nothing competes with this choice. `pr_intent` was extended in place
   (`server/src/db/schema/reviews.ts`), matching the plan's stated default.
2. **No new test files added this iteration.** The source plan's Test plan
   section called for new coverage in four suites (server-unit for the
   classification service, an extended `settings-models.it.test.ts` case, an
   extended `reviewer-core/test/prompt.test.ts`, and a new client render
   test for the `OverviewTab` intent block). None of that new coverage was
   written this iteration — existing suites were run for regression only.
   This is recorded as Follow-up (4) below, not silently dropped.

## What was implemented

**Server:**
- `server/src/modules/reviews/intent-service.ts` (new) — `IntentClassificationService`.
  Resolves the model via `resolveFeatureModel(container, workspaceId, 'review_intent')`
  and `container.llm(provider)`; cache-hits on unchanged `headSha`
  (`intent-service.ts:97-111`) with zero LLM calls on a hit; resolves an
  in-repo plan/spec reference via `container.repoIntel.readFiles` and cites
  (never fetches) an external plan/spec URL; falls back to changed
  files/commits/branch/diff-stat when the description is thin and no linked
  issue or plan/spec was found.
- `server/src/modules/reviews/run-executor.ts` — added as shared pre-work,
  once per PR, before the per-agent loop (`run-executor.ts:109-133`); wrapped
  in try/catch distinct from the diff-load try/catch so classification
  failure never blocks the review; result threaded into `runOneAgent` as
  `intentText`/`intentStats` params (`run-executor.ts:184-187`) and into the
  `reviewPullRequest({...})` call (`run-executor.ts:261`) and
  `RunTrace.stats.intent` (`run-executor.ts:333`).
- `server/src/modules/reviews/repository/pull.repo.ts` + `repository.ts` —
  pre-existing `upsertIntent`/`getIntent`, now called (previously unwired).
- `server/src/modules/pulls/routes.ts` — PR detail route now includes the
  persisted `PrIntentRecord` (`pulls/routes.ts:219-232`), best-effort
  (`.catch(() => undefined)`), for the client to render without a new round
  trip.
- `server/src/db/schema/reviews.ts` + migration
  `server/src/db/migrations/0013_black_nico_minoru.sql` — extends `pr_intent`
  with `confidence`, `source`, `provider_used`, `model_used`, `head_sha`
  (all `NOT NULL`, no default) and `created_at` (`NOT NULL DEFAULT now()`).
  Generated via `pnpm db:generate`, not hand-written.
- `server/src/vendor/shared/contracts/{brief,trace,platform}.ts` and the
  client mirrors — `Intent` gains `confidence`/`source`/`plan_ref`;
  `PromptAssembly` gains `intent: z.string().nullish()`
  (`server/src/vendor/shared/contracts/trace.ts:51`); `RunTrace.stats` gains
  a parallel `IntentStats` sub-object (`trace.ts:64-86`), recorded once per
  PR rather than duplicated per agent.

**reviewer-core:**
- `reviewer-core/src/prompt.ts` — `PromptParts.intent?: string`
  (`prompt.ts:77`); `assemblePrompt` renders a `## Intent` section wrapped in
  `wrapUntrusted('intent', ...)` (`prompt.ts:118-119`), positioned right
  after `## PR description`; `PromptAssembly.intent` recorded in parallel
  (`prompt.ts:149`); new exported `formatIntentForPrompt(intent: Intent):
  string` (`prompt.ts:165-169`) renders the structured record into the
  prompt-section string. `INJECTION_GUARD` unmodified — it already named
  "derived intent/scope" as an untrusted category before this feature landed.
- `reviewer-core/src/run.ts` / `index.ts` — export/wire `formatIntentForPrompt`.

**Client:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  — mounts a new `IntentCard`.
- `client/.../OverviewTab/_components/IntentCard/IntentCard.tsx` (new) —
  renders intent text, in/out-of-scope lists, and a confidence badge.

## Verification results (reported this session)

- `server`: 178/178 tests passing + typecheck clean.
- `client`: 97/97 tests passing + typecheck clean.
- `reviewer-core`: 23/23 tests passing + typecheck clean.
- These are **regression** runs of the pre-existing suites only — no new test
  cases were added for the Intent Layer itself this iteration (see Amendment 2
  and Follow-up 4).
- Migration was generated via `pnpm db:generate`, not hand-written, per the
  root `CLAUDE.md` "Do not touch" migrations rule.

## Review findings

Two review passes were run against the uncommitted diff. Findings below were
re-verified against current file:line content while writing this doc.

### architecture-reviewer (onion-architecture) — detailed breakdown

**1. Module boundaries**

| Boundary | Checked | Result |
|---|---|---|
| `intent-service.ts` ↔ adapters | `grep -n "^import"` on the file — no direct adapter import (GitHub client, LLM SDK, fs); all access via `Container`/`resolveFeatureModel` types | Clean |
| `run-executor.ts` ↔ `intent-service.ts` | Orchestrator instantiates the service (`new IntentClassificationService(this.container, this.repo)`) — same pattern already used one level up for `ReviewRunExecutor` itself (`service.ts:36`), not a new pattern | Matches existing pattern |
| `reviewer-core` ↔ rest of system | `prompt.ts`/`run.ts` diff adds only a `string \| undefined` field plus a pure formatting function — no new fs/db/network imports | Zero-I/O preserved |
| `pulls` ↔ `reviews` (cross-module) | `routes.ts:221` calls `container.reviewRepo.getIntent(pr.id)` directly from another module's routes file | **Not a new violation** — `pulls/` already has no `service.ts`/`repository.ts` of its own before this diff (e.g. `routes.ts:130-133` already reads `t.reviews` directly); the new call repeats an existing module-shape gap, doesn't introduce one |

**2. Dependencies (direction)**

- `intent-service.ts` depends only on `Container` (port type) and `resolveFeatureModel` — service → port, never service → concrete adapter.
- LLM access: `resolveFeatureModel(this.container, workspaceId, 'review_intent')` → `this.container.llm(provider)` — same two-step chokepoint `conventions/service.ts` already uses.
- GitHub access: `this.container.github()` — DI-resolved port, not a direct Octokit import.
- Repo-intel (plan/spec resolution): `this.container.repoIntel.readFiles(...)` — via port.
- Cross-checked against `server/src/platform/container.ts:114-163`, which defines `repoIntel`/`github`/`llm` as exactly the DI ports these calls hit.

**3. Contracts (shape/placement)**

- New fields (`intent`, `IntentStats`) added only inside `server/src/vendor/shared/contracts/*` and `PrIntentRecord`/`PromptAssembly` — no business logic leaked into contract files; they stay pure zod schemas.
- `routes.ts:216-231` — confirmed to be pure mapping of `PersistedIntent` (internal camelCase) → wire `PrIntentRecord` (snake_case), matching this file's existing "translate at the boundary" convention, no business logic added.

**4. Coupling**

- `run-executor.ts:109-133` — the intent step is isolated in its own `try/catch`, separate from the diff-load `try/catch`; a classification failure is not coupled to a diff-load failure (the plan's differing-failure-semantics requirement is respected).
- `intentText`/`intentStats` are threaded into `runOneAgent` as explicit parameters (same shape already used for `diff`) — not via a hidden global or container mutation.

**5. Data flow**

```
pull (title/body/branch/commits/diff stat)
  → IntentClassificationService.classify()
      → container.github() (linked issue, best-effort)
      → container.repoIntel.readFiles() (plan/spec, best-effort)
      → resolveFeatureModel + container.llm() (classification)
      → repo.upsertIntent() (cached by headSha)
  → run-executor.ts (intentText, intentStats)
      → runOneAgent → reviewPullRequest(..., intent: intentText)
          → reviewer-core/assemblePrompt → wrapUntrusted('intent', ...) → '## Intent' in the prompt
      → RunTrace.stats.intent (recorded once per PR, copied into each run's trace)
  → pulls/routes.ts (GET PR detail) → reviewRepo.getIntent() → wire shape → client
      → OverviewTab → IntentCard
```
One-directional flow, no write-back from `reviewer-core` into the DB — consistent with reviewer-core's zero-I/O requirement.

**6. Prompt-assembly location**

- `reviewer-core/src/prompt.ts` — the `## Intent` section is inserted in `assemblePrompt` immediately after `## PR description` (diff hunk at roughly lines 108→118), before the `## Skills / rules` block — exactly the position the plan required.
- Wrapped via `wrapUntrusted('intent', ...)` — intent is treated as untrusted input, same as the diff/PR body.
- `INJECTION_GUARD` (definition line 16, usage line 95) — `git diff reviewer-core/src/prompt.ts | grep INJECTION_GUARD` showed no hunk touching those lines, confirming the rule was not edited.

**Summary table**

| # | Status | Finding | Evidence |
|---|---|---|---|
| 1 | PASS | `intent-service.ts` reaches LLM/GitHub/repo-intel only via DI-resolved `container` ports, no direct adapter imports. | `server/src/modules/reviews/intent-service.ts:122,134,153` (`this.container.github()`, `this.container.repoIntel.readFiles`, `this.container.llm(provider)`) |
| 2 | PASS | `run-executor.ts` orchestration stays I/O-thin, delegates to the service. | `server/src/modules/reviews/run-executor.ts:116-133` |
| 3 | PASS | `reviewer-core` stays zero-I/O; `INJECTION_GUARD` unmodified. | `reviewer-core/src/prompt.ts:16-28` unchanged; `formatIntentForPrompt` is a pure function (`prompt.ts:165-169`) |
| 4 | Note (pre-existing pattern, not a violation) | `pulls/routes.ts` calls `container.reviewRepo.getIntent(pr.id)` directly, reaching into another module's repository — but `pulls/` already has no `service.ts`/`repository.ts` of its own; this pre-dates the diff. | `server/src/modules/pulls/routes.ts:221` |
| 5 | Note (migration safety, not architecture) | `0013_black_nico_minoru.sql` adds 5 `NOT NULL` columns to `pr_intent` with no `DEFAULT` — would fail on a non-empty table. | `server/src/db/migrations/0013_black_nico_minoru.sql:1-5` (`confidence`, `source`, `provider_used`, `model_used`, `head_sha`, all `NOT NULL`, no default) |

### plan-verifier (diff vs. `.claude/plans/intent-layer.md`) — full requirement matrix

| # | Plan requirement | Code / evidence | Status |
|---|---|---|---|
| 1 | Amendment 1: storage — `pr_intent`, not `pr_brief` | `server/src/db/schema/reviews.ts` extends `prIntent` itself; grep `pr_brief\|PrBrief` shows only pre-existing declarations, 0 new reads/writes | **PASS** |
| 2 | Amendment 2: no new test files | `git diff --stat -- server/test/` — only `contracts.test.ts` (+7/-1), an edit to an existing `Intent.parse(...)` fixture, not new coverage | **PASS** |
| 3 | Data sources §1: title/description/linked issue/plan-spec/Jira-regex/4 fallback signals | `intent-service.ts`: `pull.title`/`pull.body`, `linkedIssue`, `PLAN_SPEC_PATH_RE`/`BARE_URL_RE`, `JIRA_KEY_RE`, `diffFiles`+`commitMessages` (via new `getPrCommits`)+`branch`+`additions/deletions/filesCount` | **PASS** |
| 3a | §1 nuance: "linked issue reads from DB, no new GitHub call" | `intent-service.ts:118-125` makes a **new** `container.github().getPullRequest(...)` call rather than reading persisted `PrDetail.linked_issue` | **PARTIAL** — functionally fine (graceful degrade), but contradicts the plan's literal text |
| 4 | Call sequence §2: once per PR, after diff-load/before agent loop, cached by `headSha`, graceful try/catch, `.info` not `.error` | `run-executor.ts:109-133` — block sits between line 107 (`Diff ready`) and line 136 (`for (... jobs)`); its own try/catch; catch branch → `runLog.info(...)`; cache check `cached.headSha === pull.headSha` in `intent-service.ts:100-113` | **PASS** (logging-form nuance, see #13) |
| 5 | Schema §3: `confidence`(high\|low), `source`(4-enum), `providerUsed`, `modelUsed`, `headSha`, `createdAt` via `now()` | `server/src/db/schema/reviews.ts` diff — all 6 fields present with correct enum values and the `now()` helper | **PASS** |
| 6 | Migration generated via `pnpm db:generate`, not hand-written | `server/src/db/migrations/0013_black_nico_minoru.sql` — 6 `ALTER TABLE` lines matching the schema 1:1; `meta/_journal.json` + `meta/0013_snapshot.json` also updated (sign of generation, not a hand-written file) | **PASS** |
| 7 | Contracts in sync server↔client (`Intent`/`PrIntentRecord`/`PromptAssembly`/`RunStats.intent`) | `diff server/.../brief.ts client/.../brief.ts` → identical; `trace.ts`/`platform.ts` intent fields identical on both sides (only 2 pre-existing, unrelated comment differences) | **PASS** |
| 8 | API §4a: Settings model picker — verify-only, no new UI | No changes to `SettingsModels.tsx`; `feature-models.ts` already had `review_intent` before this change | **PASS** |
| 8a | API §4a: `'review_intent'` test case in `settings-models.it.test.ts` | `git diff --stat server/test/` — file unchanged | **MISSING** by the plan's letter, but covered by Amendment 2 (tests deliberately deferred) — not counted as a failure |
| 9 | API §4b: PR detail response includes intent | `pulls/routes.ts` — both branches (with-token line 277, offline-fallback line 309) return `intent` | **PASS** |
| 10 | API §4b (optional): `POST /pulls/:id/intent/refresh` | `grep intent/refresh server/src` — 0 matches | **MISSING**, but the plan itself marked this endpoint optional ("worth adding", not "required") — a deliberate, agreed scope-down |
| 11 | Prompt builder §5: `PromptParts.intent`, `## Intent` via `wrapUntrusted`, positioned right after `## PR description`, `INJECTION_GUARD` unchanged, `PromptAssembly.intent`, `formatIntentForPrompt` exported | `reviewer-core/src/prompt.ts` — all elements present (see architecture breakdown above); `formatIntentForPrompt` re-exported from `index.ts:18` | **PASS** |
| 12 | UI §6: Settings verify-only; `IntentCard`/`IntentSection` in `OverviewTab` with confidence badge; client contract mirrors | New folder `IntentCard/{IntentCard.tsx,styles.ts,index.ts}`; `IntentCard.tsx:18-65` renders text/in-scope/out-of-scope/`Badge`; `OverviewTab.tsx`+`page.tsx` wire it in; contracts in sync (see #7) | **PASS** |
| 13 | Logging §7: `runLog.step('Classifying PR intent', ...)`, `RunTrace.stats.intent` once per PR, failure → `.info` not `.error` | `RunTrace.stats.intent` recorded correctly and copied into every run's trace (`run-executor.ts:329-332`). But the literal `runLog.step(...)` call is **not used** — manual `Date.now()` + separate `runLog.info(...)` calls instead (`run-executor.ts:112-133`) | **PARTIAL** — `RunLogger.step()` (`server/src/platform/run-logger.ts:82-83`) always logs via `.error` on throw, which would contradict the plan's own explicit "failure via `.info`" requirement; the deviation looks deliberate and justified, but the literal API call is missing |

**Matrix summary:** 10 of 13 items PASS literally; 2 PARTIAL (#3a linked-issue source, #13 logging form) — both functionally justified, not missing functionality, but diverging from the plan's literal text; 2 MISSING (#8a test case, #10 refresh endpoint) — both covered by this iteration's explicit amendments/scope-downs, not unplanned gaps.

## Follow-ups

None of the following have been fixed — this doc records them for a future
session to triage, it does not fix them.

1. **Linked-issue live call vs. the plan's DB-read expectation.** The plan
   assumed `PrDetail.linked_issue` was already persisted and readable without
   a new call; in reality it's assembled live only by the pulls detail route.
   `intent-service.ts` now makes its own `container.github().getPullRequest(...)`
   call per classification (cached at the `pr_intent`/`headSha` level, so not
   per-agent, but still a new I/O surface and GitHub API call not described
   by the plan). Decide whether this is acceptable as-is or whether
   `PrDetail.linked_issue` should be persisted on ingestion instead, removing
   the duplicate call.
2. **`runLog.step` vs. manual `.info` logging.** Current manual logging in
   `run-executor.ts:113-132` is a reasonable workaround given
   `RunLogger.step()`'s hardcoded `.error`-on-throw behavior, but it diverges
   from the plan's literal ask and from this run's own log-call convention.
   Consider either extending `RunLogger.step()` with a `logKind`-on-failure
   option, or explicitly documenting this file's precedent for future
   non-fatal steps.
3. **Missing `NOT NULL` defaults in the migration — data-safety risk.**
   `server/src/db/migrations/0013_black_nico_minoru.sql` adds 5 `NOT NULL`
   columns (`confidence`, `source`, `provider_used`, `model_used`,
   `head_sha`) to `pr_intent` with no `DEFAULT`. This only worked because
   `pr_intent` was empty at migration time in this environment; it will fail
   outright against a non-empty `pr_intent` table (e.g. a shared/staging DB
   that already has classified PRs from earlier testing). Needs either
   backfill defaults or a two-step migration before this ships anywhere with
   existing data.
4. **Deferred test coverage.** Per the source plan's Test plan section, four
   suites still need new coverage that was not written this iteration:
   server-unit tests for `IntentClassificationService` (mocking
   `container.llm`, asserting `resolveFeatureModel(..., 'review_intent')` is
   called, the thin-description/no-signal → `confidence: 'low'`/`source:
   'inferred'` case, and graceful degradation on LLM failure); a
   `'review_intent'` case in `server/test/settings-models.it.test.ts`;
   `reviewer-core/test/prompt.test.ts` coverage for the `## Intent` section
   (present+wrapped when set, omitted when absent, `assembly.intent`
   mirroring); and a client render test for the new `IntentCard`/`OverviewTab`
   intent block (confidence badge, in/out-of-scope lists).
