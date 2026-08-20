# Development Plan — Skill Editor (`/skills/:id`, 6 tabs)

**Execution mode:** multi-agent

Source spec: `docs/specs/SPEC-06-skill-editor.md` (Status: implemented — see
that file's header). This plan translates its Goals G1–G7, Acceptance
criteria AC-1–AC-32, and Task checklist T1–T16 into ordered implementation
steps. AC/T numbers below refer to that spec; re-read it (not this plan) for
the exact EARS wording when a step's intent is unclear.

> **Promoted record.** This is the completed, verified Development Plan for
> SPEC-06 — all 11 execution steps below ran, and the `plan-verifier`/
> `architecture-reviewer` loop reported no unresolved critical/major findings
> against this plan's ACs. Promoted from the working copy at
> `.claude/plans/skill-editor.md` into this permanent location per this
> repo's `docs/plans/` convention (mirrors `docs/plans/spec-04-pr-why-risk-brief.md`
> etc.). The per-step implementation log (files touched, design decisions,
> deviations, coordinator verification commands/results) is not duplicated
> here — see the session's progress journal referenced from the SPEC-06
> commits.

## Decisions carried over from the spec's own "Open questions" (not re-litigated here)

The spec's header explicitly states its `[NEEDS CLARIFICATION]` markers are
Development-Plan-level, not implementation-planner blockers (SPEC-05
precedent). Adopting its own recommendations as locked decisions for this
plan:

- **No client-side redirect** for the old bookmarked `/skills?skillId={id}`
  URL — AC-2 removes the branch that opened the drawer for it; the query
  param is simply ignored going forward, no new redirect logic.
- **No confirm dialog before Restore** (Versions tab) — behaves like a
  normal Config save (which also has no confirm step), per SPEC-05's
  "Promote v{N}" precedent (T15) not having one either.
- **`SkillStats` aggregator file placement**: `server/src/modules/skills/stats-repository.ts`
  + `stats-helpers.ts`, mirroring `server/src/modules/agents/stats-repository.ts`
  + `stats-helpers.ts` exactly (Step 3 below).
- **Restore's client cache**: implemented as a call to the existing
  `useUpdateSkill` hook (`client/src/lib/hooks/skills.ts:45-54`), whose
  `onSuccess` already does `invalidateQueries(["skills"])` +
  `setQueryData(["skill", id], data)` — Config/Preview tabs see the restored
  `body` without a manual refetch, for free.
- Injection-guard gap on the `skills` block in `reviewer-core/src/prompt.ts`
  — the spec's NFR section flagged this as inherited and out of scope for
  this plan; it has since been **fixed separately** (standalone security fix,
  landed ahead of this plan: `skillsBlock` now goes through `wrapUntrusted()`
  exactly like `specsBlock`, plus a regression test in
  `reviewer-core/test/prompt.test.ts`). Nothing left to do here — mentioned
  only so the `architecture-reviewer` doesn't re-flag it as still open.
- The missing rate limit on `POST /*/evals/:caseId/run` (single-run) is
  still genuinely out of scope — an inherited, pre-existing gap the spec's
  NFR section documents but does not ask this plan to close.

## Context

`/skills` today is a flat card grid with a 193-line, tab-less `SkillDrawer`
for preview/edit. `/agents/:id` already has the richer "editor" form (tabs,
`?tab=` state, its own route) that this plan ports to skills, plus two
skill-specific additions no agent has: a read-only **Preview** tab and a
**Versions** tab (diff + restore over the already-working `skill_versions`
history). The **Evals** tab is the course-feedback-driven gap this spec
exists to close: skills currently have no way to be tested in isolation
before being linked into a real agent — `EvalsService`/`EvalsRepository` are
already `owner_kind`-agnostic at the data layer (confirmed:
`server/src/modules/evals/repository.ts:50-65,156-175,179-186,192-209` all
take `ownerKind: 'skill' | 'agent'` already) but nothing above the
repository ever passes `'skill'` through, and no skill-facing routes exist.

Three items the pre-spec research session got wrong are **already working,
not to be rebuilt** (verified again during planning, same file:line the spec
cites): `SkillsRepository.update()` already version-bumps + snapshots on
`body` change (`server/src/modules/skills/repository.ts:77-104`); skill
context-docs routes + UI already exist end-to-end
(`server/src/modules/project-context/routes.ts:70-91`,
`client/src/app/skills/_components/SkillDrawer/SkillDrawer.tsx:175-186`) and
only need to move into the new Context tab unchanged. The Stats tab (G6) is
genuinely new work — no `skill-stats` module, no aggregation, exists today.

## Modules involved

- **server** (`@devdigest/api`) — generalize `EvalsService`/routes to accept
  `ownerKind`, add skill-owned eval routes, a new `'skill_eval'`
  `FeatureModelId`, a new `GET /skills/:id/versions` route, and a new
  skill-stats module (`GET /skills/:id/stats`).
- **client** (`@devdigest/web`) — new `/skills/:id` route + 6-tab
  `SkillEditorView`, retire `SkillDrawer`'s `"edit"` mode, generalize the
  eval hooks + promote `EvalsTab` to a parameterized shared component,
  promote `diffPromptLines`/`PromptDiffLine`.
- **shared contracts** (`server/src/vendor/shared` + its client mirror at
  `client/src/vendor/shared`) — new `FeatureModelId` value, new `SkillStats`
  and `SkillVersion` contracts. **Both copies**, every time (root
  `INSIGHTS.md` 2026-07-31 — the two trees are physically separate,
  git-tracked, with no symlink/sync script; a commit that updates only one
  side breaks `client`'s `pnpm typecheck` silently until someone notices).
- **reviewer-core** — untouched. `executeCase`'s narrowed parameter type
  (AC-14) only affects the caller in `server/src/modules/evals/service.ts`;
  `reviewPullRequest`'s own signature does not change.

## Constraints

- **Wire contracts are snake_case at the route boundary**, camelCase in
  Drizzle/TS (root `CLAUDE.md`) — `SkillVersion`/`SkillStats` DTOs follow the
  same `toXDto()` mapping convention already used by `toSkillDto`/
  `computeAgentStats`.
- **Module shape**: `modules/<name>/` = `routes.ts` + `service.ts` +
  `repository.ts`; when data access grows, split into
  `repository/<entity>.repo.ts` or a sibling `stats-repository.ts` (exactly
  the pattern `agents/stats-repository.ts` + `stats-helpers.ts` already
  establish — mirror it for skills, do not invent a new shape).
- **Client feature-folder shape**: `_components/<Name>/` with `<Name>.tsx` +
  `index.ts` + `styles.ts`/`helpers.ts`/`constants.ts` as needed +
  `<Name>.test.tsx`.
- **Migrations**: none needed. `skill_versions` (schema.ts, used by AC-28)
  and every table `SkillStats` reads (`agent_skills`, `agent_runs`,
  `reviews`, `findings`) already exist — this plan reads/joins existing
  tables, no `pnpm db:generate` step, no new migration file.
- **Dual-copy shared contracts** (root `INSIGHTS.md` 2026-07-31): every
  contract change in this plan (`FeatureModelId`/`FEATURE_MODELS`,
  `SkillVersion`, `SkillStats`) must land identically in
  `server/src/vendor/shared/contracts/*.ts` **and**
  `client/src/vendor/shared/contracts/*.ts`.
- **`../` relative-import depth is not safe to eyeball** for deeply nested
  `_components/<Tab>/<Tab>.tsx` files (client `INSIGHTS.md` 2026-08-02, two
  separate entries — `EvalsTab.tsx` and `StatsTab.tsx` each got the count
  wrong by one level when copied from a brief). Every new tab component
  under `SkillEditorView/_components/**` must import
  `@/lib/hooks/*`/`@/components/*` via the `@/` alias, never a counted
  `../../../../` chain — compute depth with
  `node -e "console.log(path.relative(fromDir, toDir))"` if an alias
  genuinely isn't available for some import.
- **`ValidationError` → HTTP 422, not 400** (server `INSIGHTS.md`
  2026-08-01, `server/src/platform/errors.ts:25-29`) — the new
  `evals-skill-owner.it.test.ts`'s empty-case-set assertion (mirroring the
  existing agent 422 behavior, SPEC-05 AC-13) must expect 422.
- **`IdParams` validates `:id` as UUID before the handler runs**
  (server `INSIGHTS.md` 2026-08-06, `server/src/modules/_shared/schemas.ts:11`)
  — any new 404-on-unknown-skill test (AC-19, AC-32) must use a
  UUID-shaped unknown id, or it gets 422 instead of the intended 404.
- **No route in `evals/routes.ts` declares a zod `response` schema**
  (server `INSIGHTS.md` 2026-08-19 decision) — the new skill-owned routes
  follow the same convention (no `response` schema), so `EvalRunRecord`'s
  existing `system_prompt_snapshot` field (AC-16) flows through
  `toEvalRunRecordDto` unchanged, no route-level serialization risk.
- **`FEATURE_MODELS` default-provider changes have hermeticity blast
  radius** (server `INSIGHTS.md` 2026-08-04) — the new `'skill_eval'` entry
  defaults to `openrouter`, matching `onboarding`/`review_intent`/
  `conventions`'s existing tier; the new `evals-skill-owner.it.test.ts` must
  mock `overrides.llm.openrouter` explicitly (same pattern already used in
  `reviews-skills.it.test.ts`/`agent-stats.it.test.ts`), not rely on a
  provider mock added for a different feature.
- **`<Markdown>` is already safe for arbitrary/untrusted text** (client
  `INSIGHTS.md` 2026-08-13 — raw `<script>` renders as inert visible text,
  not a real DOM node) — the Preview tab needs zero new sanitization code.
- **Duplicate-`getByText` test pitfalls** are a recurring class in this
  codebase (client `INSIGHTS.md` 2026-07-31, 2026-08-13 ×2, 2026-08-19 ×3) —
  any new test fixture with two numerically-equal stats (e.g.
  `used_by_agents`/`pull_rate`/`accept_rate` in `StatsTab.test.tsx`, or two
  `run_group`s producing an identical delta in a promoted `EvalsTab`) must
  deliberately use distinct values, or scope the query with `within(...)`/
  `getAllByText` — do not copy fixture numbers from the spec's own mockup
  copy ("74% accept") without checking for collisions against sibling
  fixture values in the same test.
- **`@testing-library/user-event` is not installed** (client `INSIGHTS.md`
  2026-08-13) — new tests use `fireEvent`, not `userEvent`; do not add the
  dependency as a drive-by (lockfiles are do-not-touch, root `CLAUDE.md`).
- **`icon="Edit"`, not `icon="Pencil"`** for any edit-affordance icon
  (client `INSIGHTS.md` 2026-08-19) — `@devdigest/ui`'s `IconName` registry
  aliases `Edit: Pencil`; `"Pencil"` compiles far away from the error and
  only fails a wide `tsc --noEmit` union-type check.
- **Coordinator must run tests/typecheck itself if `implementer`'s session
  lacks `Bash`** — root `INSIGHTS.md` documents this happening 4 times
  already, twice specifically on this same evals/`EvalsTab` corner of the
  codebase (2026-08-19 ×2). Since this plan's Steps 1 and 5 touch exactly
  that corner (`EvalsTab` generalization, `evals/service.ts`), the
  `plan-verifier`/coordinator loop should not assume `pnpm test`/
  `pnpm typecheck` ran inside the `implementer` session — verify directly.
- **Rate limit precedent**: `POST /skills/:id/eval-runs` must carry the same
  `{max: 5, timeWindow: '1 minute'}` config already on
  `POST /agents/:id/eval-runs` (`server/src/modules/evals/routes.ts:99-108`,
  SPEC-05 AC-22) — copy the `config: { rateLimit: {...} }` block verbatim.

## Skills the implementer will use

- **`onion-architecture`** — every server step touches `server/src/modules/**`
  and `server/src/platform/container.ts` (`EvalsService` gains a
  `resolveRunConfig` branch, `SkillsService` gains `getStats`/`listVersions`,
  a new `SkillStatsRepository`). Routes must stay thin HTTP↔service
  translation; the synthetic skill-eval config (AC-14) is built in the
  service layer, never in `routes.ts`.
- **`react-ui-architecture`** — governs where the promoted `EvalsTab` (T8)
  and `diffPromptLines`/`PromptDiffLine` (T13) land once a second,
  cross-feature caller exists ("promote on the second user" — already the
  established rule behind `EvalCaseModal`'s move to
  `client/src/components/eval-case-modal/`, client `INSIGHTS.md` 2026-08-19
  decision), and where new `SkillEditorView/_components/<Tab>/` folders go.
- **`zod`** — every new/changed contract (`FeatureModelId` enum member,
  `SkillVersion`, `SkillStats`, request bodies for the new skill-eval
  routes) goes through `server/src/vendor/shared/contracts/*.ts` zod
  schemas, mirrored to the client copy.
- **`fastify-best-practices`** — new routes follow the existing
  `withTypeProvider<ZodTypeProvider>()` + `{ schema: { params, body } }`
  pattern already used throughout `evals/routes.ts`/`skills/routes.ts`;
  rate-limit config on the bulk skill-eval route follows the same
  `config: { rateLimit }` shape as the existing agent route.
- **`react-best-practices`** — `SkillEditorView` and its 6 tab components are
  client components following the same hooks/props shape as `AgentEditor`
  and its tabs; no new state-management pattern introduced.
- **`postgresql-table-design`** — informs (but should NOT require) the
  `SkillStats` aggregation query design (Step 3): confirm the
  `agent_skills → agent_runs → reviews → findings` join chain is
  index-friendly (existing FKs/PKs only — no new index needed, since this
  mirrors `agents/stats-repository.ts`'s already-accepted query shape one
  hop further).
- **`security`** — the NFR section already ran this pass at spec time
  (bulk-eval cost abuse mitigated by the rate limit, access control via
  workspace-scoped `getContext` checks before any DB write/LLM call,
  logging discipline for skill-eval runs). The implementer replicates those
  already-decided mitigations; it does not re-derive them from scratch. The
  `wrapUntrusted()` gap on `reviewer-core/src/prompt.ts`'s `skills` block is
  already fixed (separate, prior security fix — see "Decisions carried over"
  above) and needs no action from this plan.
- **`engineering-insights`** — if the join query for `pull_rate`/
  `accept_rate`/cost-attribution (AC-24–AC-26) surfaces a non-obvious
  Drizzle/Postgres gotcha, or the `EvalsTab` generalization hits an import-depth
  or duplicate-text test trap not already covered by the entries cited
  above, record it in `server/INSIGHTS.md`/`client/INSIGHTS.md` per the
  usual convention.

## Ordered steps

Grouped by dependency order (server API surface the client will consume,
then the client route). T-numbers in brackets map back to the spec's own
checklist for traceability.

### Step 1 — Server: generalize Evals to `ownerKind` [T5, T6, T9]

1. `server/src/vendor/shared/contracts/platform.ts` **and**
   `client/src/vendor/shared/contracts/platform.ts`: add `'skill_eval'` to
   `FeatureModelId`'s enum, and a matching entry to `FEATURE_MODELS`:
   `{ id: 'skill_eval', label: 'Skill Eval', description: "Runs a skill's
   isolated eval set to test it before enabling.", defaultProvider:
   'openrouter', defaultModel: 'deepseek/deepseek-v4-flash' }` (same tier as
   `onboarding`/`review_intent`/`conventions`).
2. New `server/src/modules/evals/constants.ts`: export
   `SKILL_EVAL_SYSTEM_PROMPT` with the exact string from spec AC-14 (a code
   constant, never read from DB/client — see "Inputs and provenance").
3. `server/src/modules/evals/service.ts`:
   - Thread `ownerKind: 'agent' | 'skill'` through `list`/`create`/`update`/
     `delete`/`run`/`runSet`/`listSetRuns`, replacing the hardcoded
     `'agent'` literals currently passed to `this.repo.listByOwner`/
     `insert`/etc. (repository itself is unchanged — already
     `ownerKind`-agnostic).
   - Narrow `executeCase`'s first parameter from `AgentRow` to
     `{ provider: Provider; model: string; systemPrompt: string }` — verify
     `executeCase`'s body only reads those three fields (confirmed at
     `server/src/modules/evals/service.ts:180,186-187` — `agent.provider`,
     `agent.model`, `agent.systemPrompt`), so `AgentRow` still satisfies the
     narrowed type structurally and the `run()`/`runSet()` call sites need
     no change beyond passing the new object shape for the skill branch.
   - New private `resolveRunConfig(workspaceId, ownerKind, ownerId)`:
     - `'agent'` branch — unchanged logic moved from the top of `run()`/
       `runSet()` (resolve `AgentsRepository.getById` + `linkedSkills`,
       filter `enabled`).
     - `'skill'` branch — `container.skillsRepo.getById(workspaceId,
       ownerId)`, build the synthetic object per AC-14: `systemPrompt:
       SKILL_EVAL_SYSTEM_PROMPT`, `provider`/`model` from
       `resolveFeatureModel(container, workspaceId, 'skill_eval')`,
       `skillBodies: [skill.body]` — **no** `enabled` filter on the
       skill-under-test (AC-15), unlike the agent branch's linked-skills
       filter.
   - `runSet`'s per-row `systemPromptSnapshot` (AC-16) becomes whichever
     `systemPrompt` `resolveRunConfig` returned, not always
     `agent.systemPrompt`.
4. Regression check (T9, no new code): confirm `dashboard()`
   (`service.ts:350-354`) still hardcodes `'agent'` in its
   `this.agents.list`/`caseCountsByOwner`/`allSetRuns` calls — add an
   assertion to a new/extended integration test that a skill-owned
   case/set-run exists in the DB but is absent from `GET /eval-dashboard`'s
   response (AC-20).

### Step 2 — Server: skill-owned eval routes [T7]

In `server/src/modules/evals/routes.ts` (same plugin file, same module —
no new `modules/index.ts` registration needed): add, mirroring the existing
agent routes 1:1 —

- `GET/POST /skills/:id/evals`
- `PUT/DELETE /skills/:id/evals/:caseId`
- `POST /skills/:id/evals/:caseId/run`
- `GET/POST /skills/:id/eval-runs` — the `POST` carries the same
  `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` as
  `POST /agents/:id/eval-runs` (AC-18).

Each handler resolves `workspaceId` via `getContext` and checks the skill
belongs to that workspace **before** calling into `EvalsService` (AC-19) —
same shape as the existing agent routes' `app.container.agentsRepo.getById`
guard on `GET /agents/:id/eval-runs`.

New `server/test/evals-skill-owner.it.test.ts`: CRUD roundtrip for a
skill-owned case, single-run and bulk-run persist `eval_runs` rows with
`system_prompt_snapshot = SKILL_EVAL_SYSTEM_PROMPT`, a disabled skill still
runs on its current `body` (AC-15), bulk run on an empty case set returns
422 (not 400 — see Constraints), 429 on exceeding the rate limit, 404 on a
foreign-workspace `:id` before any LLM/DB-write call.

### Step 3 — Server: `SkillStats` [T10]

1. New `server/src/modules/skills/stats-repository.ts` (mirrors
   `agents/stats-repository.ts`'s shape) — one method that, given
   `workspaceId`/`skillId`, returns the raw rows needed for the pure
   aggregator:
   - Distinct agent ids from `agent_skills` where `skill_id = :skillId`
     (AC-23, direct attachment only).
   - `agent_runs` rows for those agent ids, `status = 'done'`,
     `ran_at >= now() - 30 days` — every column `computeAgentStats` already
     reads (`costUsd`, `findingsCount`, `skillIds`) plus enough to determine
     denominator vs numerator for `pull_rate` (AC-24: numerator = rows whose
     `skill_ids` jsonb array contains `skillId`, denominator = all such
     agents' done runs in the window).
   - `reviews` joined by `run_id` to the numerator run set, then `findings`
     for those reviews (`category`, `acceptedAt`, `dismissedAt`) — feeds
     `accept_rate` (AC-25) and the per-category cost attribution (AC-26).
2. New `server/src/modules/skills/stats-helpers.ts`'s
   `computeSkillStats()` — pure, no DB, unit-testable in isolation (mirrors
   `agents/stats-helpers.ts`'s `computeAgentStats`):
   - `used_by_agents` = count of distinct linking agent ids.
   - `pull_rate` = numerator/denominator per AC-24, `null` when denominator
     is 0 (never `0%`).
   - `accept_rate` = `accepted / (accepted + dismissed)` over the findings
     set from Step 1, `null` when that set has no decided finding (vacuous
     null, matches `stats-helpers.ts:99`'s existing convention).
   - Cost-by-category donut (AC-26): for each numerator run with non-null
     `costUsd` and `findingsCount > 0`, add `costUsd / findingsCount` to
     that run's own findings' categories; runs with `findingsCount === 0`
     or `costUsd === null` contribute nothing (no `NaN`, no divide-by-zero)
     — the explicitly-rejected alternative (attributing full `costUsd` to
     every represented category) must NOT be implemented.
   - Empty/never-linked skill (AC-27): `used_by_agents: 0`, `pull_rate:
     null`, `accept_rate: null`, empty agent list, empty donut — no failing
     query (short-circuit before the joins when `agent_skills` yields no
     rows).
3. New contract `SkillStats` — place alongside `AgentStats` in
   `server/src/vendor/shared/contracts/observability.ts` (and the client
   mirror), same DTO-mapping convention.
4. `SkillsService.getStats(workspaceId, id)` + new `GET /skills/:id/stats`
   in `server/src/modules/skills/routes.ts`, 404 before computing anything
   if the skill isn't in that workspace.
5. New `server/test/skill-stats.test.ts` (unit — pure aggregation:
   `pull_rate`/`accept_rate` null on an empty set, cost attribution divides
   evenly per finding, category sums equal total attributed cost) and
   `server/test/skill-stats.it.test.ts` (integration — real Postgres join
   through `agent_skills → agent_runs → reviews → findings`).

### Step 4 — Server: `GET /skills/:id/versions` [T12]

1. New contract `SkillVersion` (`server/src/vendor/shared/contracts/knowledge.ts`,
   next to `Skill`, plus client mirror) — `{ skill_id, version, body,
   created_at }`.
2. `SkillsService.listVersions(workspaceId, id)`: workspace-ownership check
   (`this.repo.getById(workspaceId, id)`) **before** calling
   `repo.listVersions(id)` (AC-32 — the existing
   `SkillsRepository.listVersions(skillId)` does not itself take a
   `workspaceId`), same idiom as
   `ProjectContextService.listSkillDocs` (`service.ts:138-142`).
3. New `GET /skills/:id/versions` in `server/src/modules/skills/routes.ts`.
4. Extend `server/test/skills.it.test.ts`: version list grows on each
   `body`-changing `PUT`, 404 on a foreign-workspace `:id`.

### Step 5 — Client: eval hooks + `EvalsTab` generalization [T8]

1. `client/src/lib/hooks/evals.ts`: every hook takes
   `{ ownerKind: 'agent' | 'skill'; ownerId: string }` instead of a bare
   `agentId`; the base path switches between `/agents/:id/...` and
   `/skills/:id/...`. Query keys gain the `ownerKind` dimension
   (`["evals", ownerKind, ownerId]`, etc.) so an agent's and a skill's
   caches never collide.
2. Promote `EvalsTab` (currently
   `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`)
   into a shared, parameterized location —
   `client/src/components/eval-owner-tab/` (kebab-case, matching the
   existing `client/src/components/eval-case-modal/` precedent) — accepting
   `{ ownerKind, ownerId }` instead of a hardcoded `agentId`. Both callers
   (`AgentEditor`'s Evals tab, the new `SkillEditorView`'s Evals tab) pass
   their own `ownerKind`/`ownerId`. Import hooks/utilities via the `@/`
   alias inside the promoted component (not a counted `../` chain — see
   Constraints).
3. `EvalCaseModal` needs **no changes** (AC-21) — it already takes
   `ownerKind`/`ownerId` structurally compatible props; confirm this by
   inspection before assuming a change is needed.
4. Update `EvalsTab.test.tsx` (moved alongside the promoted component) —
   the existing agent-owner test scenarios must still pass unmodified in
   behavior; add a skill-owner scenario asserting the base request path is
   `/skills/{id}/eval-runs`, not `/agents/...`.

### Step 6 — Client: route scaffold, `SkillDrawer`/`SkillsListView` changes [T1]

1. `client/src/app/skills/[id]/page.tsx` (new, thin) — delegates to
   `_components/SkillEditorView/SkillEditorView.tsx`. Mirrors
   `AgentEditorPage.tsx`'s pattern precisely for the parts the spec calls
   out: `?tab=` state via `useSearchParams`/`router.replace`, `VALID_TABS`
   derived from `SkillEditorView`'s own `TABS` constant (never a
   separately-hand-maintained list — the exact bug `AgentEditorPage.tsx:16-21`'s
   comment documents), and an `ErrorState` branch (same component/props
   shape as `AgentEditorPage.tsx:46-57`) on a 404 from `useSkill(id)`. The
   spec does not call for an agent-editor-style left sidebar of sibling
   skill cards inside this route — page-chrome details beyond `?tab=`/
   `ErrorState`/thin-delegation are the implementer's call, following
   `AgentEditorPage.tsx`'s header conventions (name, version badge,
   enabled/disabled badge) where natural.
2. `_components/SkillEditorView/constants.ts` — `TABS` = config/context/
   preview/evals/stats/versions, icons `Settings`/`FileText`/`Eye`/
   `FlaskConical`/`BarChart`/`History` (all already in `@devdigest/ui`'s
   `IconName` registry — confirmed present in `client/src/vendor/ui/icons.tsx`;
   add none new).
3. `client/src/app/skills/_components/SkillsListView/SkillsListView.tsx`:
   card `onClick` navigates to `/skills/{id}` instead of
   `router.push(`/skills?skillId=${id}`)`; delete the
   `mode === "none" && selectedId` branch (lines 37-39) that opened
   `SkillDrawer` in `"edit"` mode.
4. `client/src/app/skills/_components/SkillDrawer/SkillDrawer.tsx`: remove
   `"edit"` from the `mode` union and every branch keyed on it (the
   `useSkill`/`useSkillContextDocs` edit-mode reads, the edit-only fields,
   the delete button). `submit()` for `"create"`/`"import"` calls
   `router.push(`/skills/${skill.id}?tab=config`)` instead of `onClose()`
   (same pattern as `CreateAgentModal.tsx:32`).
5. New `SkillEditorView.test.tsx` (6 tabs render, an invalid `?tab=` falls
   back to `config`, a 404 skill id shows `ErrorState`); update
   `SkillsListView.test.tsx` (card click navigates, does not open a
   drawer) and `SkillDrawer.test.tsx` (successful create/import navigates,
   does not just close).

### Step 7 — Client: Config / Preview / Context tabs [T2, T3, T4]

1. `_components/SkillEditorView/_components/ConfigTab/ConfigTab.tsx` — the
   fields `SkillDrawer`'s old `"edit"` mode rendered (name/description/
   type/body/Enabled toggle/`"v{version}"` badge), minus the Context
   section (that moves to its own tab, Step 7.3), plus a token-count label
   next to the body editor using the existing `approxTokens(chars) =
   Math.ceil(chars/4)` helper (`client/src/lib/hooks/project-context.ts:70-75`
   — import it from there, do not reimplement). Untrusted-notice banner
   uses the unchanged condition (`existing.source !== "manual" &&
   !existing.enabled`, `SkillDrawer.tsx:105,140-142`). Saving persists via
   the existing `PUT /skills/:id` (`useUpdateSkill`) — no new server
   mutation.
2. `_components/PreviewTab/PreviewTab.tsx` — `<Markdown>{skill.body}</Markdown>`
   from `@devdigest/ui`, no textarea, no edit affordance.
3. `_components/ContextTab/ContextTab.tsx` (skill-scoped) — the same
   `ContextDocPicker` + "SERIALIZES AS" block currently in `SkillDrawer.tsx:175-186`,
   moved verbatim, wired to the already-existing
   `useSkillContextDocs(skillId)`/`useSetSkillContextDocs(skillId)`. No
   server-side changes anywhere in this step.
4. New `ConfigTab.test.tsx`, `PreviewTab.test.tsx` (renders markdown, no
   `<textarea>`/`contentEditable` in the DOM), `ContextTab.test.tsx`
   (attach/detach roundtrip against the existing hooks, same mock pattern
   as the agent `ContextTab.test.tsx`).

### Step 8 — Client: Stats tab [T11]

`_components/StatsTab/StatsTab.tsx` (skill-scoped) — `MetricCard` tiles
(Used by / Pull rate / Accept rate, "—" for `null`), a `BarRow` list
"Agents using this skill", and a `Donut` "Findings by category" using the
component's **default** `valuePrefix="$"` (do not override it to `""` the
way the agent `StatsTab` does for raw counts — `Donut`'s default already
formats as dollars via `s.value.toFixed(2)`,
`client/src/vendor/ui/charts/Donut.tsx:15,49-51`) with segment colors from
the same array the agent `StatsTab` uses
(`["var(--crit)", "var(--warn)", "var(--accent)", "var(--ok)",
"var(--text-muted)"]`). New `StatsTab.test.tsx` — deliberately give
`used_by_agents`/`pull_rate`/`accept_rate` distinct fixture values (see
Constraints' duplicate-text note).

### Step 9 — Client: Versions tab [T13, T14]

1. Promote `diffPromptLines`/`PromptDiffLine` out of
   `client/src/app/eval-dashboard/[agentId]/_components/CompareRunsModal/helpers.ts`
   into a new `client/src/lib/text-diff.ts` (not `eval-runs.ts` — this
   utility isn't eval-specific). `CompareRunsModal` imports from the new
   location; behavior unchanged. Update `CompareRunsModal.test.tsx`
   accordingly.
2. `_components/VersionsTab/VersionsTab.tsx` — list of `skill_versions`
   (newest first, from the new `GET /skills/:id/versions`), select exactly
   two → render a diff via `diffPromptLines`, a Restore button on a
   selected version that calls `useUpdateSkill({ id, patch: { body:
   version.body } })` (no new mutation — see the cache note in "Decisions
   carried over"). A no-op Restore (selected `body` already equals current)
   relies entirely on the existing server-side `bodyChanged` guard
   (`repository.ts:85`) to skip creating a new version — no client-side
   duplicate check needed.
3. New `VersionsTab.test.tsx` — diff renders for two selected versions,
   Restore calls `PUT /skills/:id` with the selected version's body.

### Step 10 — Client: wire the 6 tabs into `SkillEditorView` [T15]

Connect all six tab components (Steps 6–9) inside `SkillEditorView`
(Step 6's scaffold), same `tab === "..."` conditional-render shape as
`AgentEditor.tsx:19-42`. Extend `SkillEditorView.test.tsx` — switching
between all 6 tabs renders each one's expected content.

### Step 11 — i18n [T16]

New keys under `client/messages/en/skills.json` for Config/Preview/Context/
Stats/Versions tab labels and copy. Reuse, don't duplicate: the file
already has an unused `detail.crumbSkill`/`detail.back`/`detail.loadError`/
`detail.notFound.{title,body}` block (`client/messages/en/skills.json`
lines 27-34) that appears to have been provisioned for exactly this route —
check it for reusable keys before adding new ones with the same meaning.
The `eval` namespace (used by the promoted `EvalsTab`) is already
`ownerKind`-agnostic and needs no changes for the Evals tab's copy. No new
AC — covered by the `getByText`/`getByRole` assertions already written in
Steps 6-10's tests, no standalone translation-file test (same approach as
SPEC-05's T10/T11).

## Test plan

- **server unit** (no Docker): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  — covers `skill-stats.test.ts` (pure aggregation), any new
  `resolveRunConfig`/`executeCase` narrowing unit coverage, and
  `server/test/contracts.test.ts`'s extended `FeatureModelId.parse('skill_eval')`
  case.
- **server integration** (needs Docker): `cd server && pnpm exec vitest run .it.test`
  — `evals-skill-owner.it.test.ts` (CRUD, single/bulk run, 429, 404-before-LLM,
  `system_prompt_snapshot`), `skill-stats.it.test.ts` (real join), extended
  `skills.it.test.ts` (versions list growth + 404), extended
  `evals.it.test.ts` (dashboard excludes skill-owned rows, AC-20).
- **server both**: `pnpm test`.
- **client**: `cd client && pnpm test` (component/interaction, jsdom,
  `fetch` mocked) covering every new/changed `*.test.tsx` in Steps 5-10, and
  `pnpm typecheck` (both `vendor/shared` copies must compile together —
  this is where a missed client-side contract mirror shows up first).
- A pass looks like: all four commands above green, plus the
  `plan-verifier`/`architecture-reviewer` loop (via `sdd-implement`)
  reporting no unresolved findings against this plan's ACs after up to 3
  feedback rounds.

## Out of scope

Architecture review and security review are explicitly **not** part of this
plan or the executing `implementer` agent's job — the NFR section of
SPEC-06 already ran a security pass at spec time (documented findings:
bulk-cost-abuse MEDIUM mitigated by the rate limit in Step 2, access-control
HIGH→MEDIUM mitigated by workspace-scope checks in every new route/service
method, the pre-existing `wrapUntrusted()` gap on the skills prompt block —
since fixed separately, see "Decisions carried over" — logging discipline
for skill-eval runs). Re-running
that judgment belongs to the `architecture-reviewer`/security review agents
in the `sdd-implement` loop, not to this plan or to `implementer`.
