# Development Plan — Export to CI (serialize an agent into a GitHub Actions review)

**Execution mode:** multi-agent

Spec: `docs/specs/SPEC-08-export-to-ci.md` (Status: approved). This plan does
not restate its Goals/Non-goals/AC — it turns the already-approved Task
checklist (T1-T16) into ordered, file-scoped work for implementers, and
resolves the handful of implementation-level decisions the spec deliberately
left open (Open questions section).

## Context

The `ci`-module slot of the studio (`ci_installations`/`ci_runs` tables,
`eval-ci.ts` contracts) has sat unused since it was scaffolded. A separate,
already-tested (19/19) package (`agent-runner/`, branch `homework-08`) was
built assuming this module would exist at specific paths
(`server/src/modules/ci/manifest.ts`, `.../workflow.ts` — cited by
`agent-runner/src/manifest.ts:9` and `agent-runner/CLAUDE.md`'s "Read When").
This plan materializes that module, wires it to `agent-runner`, extends two
already-tested `agent-runner` files with two new fields the lab requires
(`commit_sha`, `model` in the trace), and builds the four-step Export Wizard +
CI Runs page + agent CI tab that consume it. Outcome: an agent configured in
the studio can be exported as a real, runnable GitHub Actions workflow, and
its CI runs become visible back in the studio via a pull-based ingest loop
(no push endpoint, no new secret channel).

## Modules involved

- **server** (`server/src/modules/ci/` — new; `server/src/db/schema/ci.ts`,
  a new migration; `server/src/vendor/shared/adapters.ts` +
  `server/src/adapters/github/{octokit,mocks}.ts` — new `GitHubClient`
  methods; `server/src/modules/index.ts` — one new registration).
- **client** (`client/src/app/agents/[id]/_components/AgentEditor` — new `ci`
  tab; new `_components/ExportWizard/`; new `app/ci-runs/page.tsx`; new
  `lib/hooks/ci.ts`; new `messages/en/ci.json` keys).
- **shared contracts** (`server/src/vendor/shared/contracts/eval-ci.ts` AND
  `client/src/vendor/shared/contracts/eval-ci.ts` — both dual copies, per the
  repo's known dual-copy pattern).
- **agent-runner** (`agent-runner/src/context.ts`, `agent-runner/src/artifact.ts`
  — two point edits, spec-mandated, touching files this package's own
  `CLAUDE.md` flags as "Do Not Touch Without Reading").
- Not touched: `reviewer-core/**`, `server/src/modules/reviews/**`,
  `multi_agent_runs`/`reviews/` (SPEC-07 territory — explicit non-goal).

## Constraints

- **Wire contracts are snake_case; both `vendor/shared` copies must move
  together.** Root `INSIGHTS.md:46-61` (2026-07-31 entry) documents a real
  incident where one copy was updated and the other wasn't, breaking
  `client` typecheck. Confirmed still true today: the client copy
  (`client/src/vendor/shared/contracts/eval-ci.ts:150-219`, read this
  session) jumps straight from `CiFile` to `CiExportInput` — it has **no**
  `AgentManifest`/`AgentManifestInput` block at all, unlike the server copy
  (`server/.../eval-ci.ts:190-217`). T1 must port that block 1:1, not just
  add the three new `CiResultArtifact` fields.
- **`db:generate`/`db:migrate`/`db:seed` all silently no-op in this worktree**
  because its path contains a space (`.../ai agent/devdigest-ci`) — the
  CLI-entrypoint guard (`import.meta.url === file://${argv[1]}`) never
  matches. Root `INSIGHTS.md:24-34` + `server/INSIGHTS.md:16-24,362-384,
  530-551`. Practical effect for T2: `pnpm db:generate` itself is fine
  (drizzle-kit's own CLI doesn't use this guard — but invoke the binary
  directly, `node node_modules/drizzle-kit/bin.cjs generate`, not `pnpm exec`,
  per root `INSIGHTS.md:24-34`'s separate `ERR_PNPM_IGNORED_BUILDS` gotcha).
  Applying the migration to actually verify the new columns exist requires
  the `pathToFileURL`-based workaround already fixed into `migrate.ts`/
  `seed.ts` per `server/INSIGHTS.md:530-551` — confirm this fix is still
  present (`server/src/db/migrate.ts:37-43`) before assuming plain
  `pnpm db:migrate` proves anything; verify by `\d ci_runs` / `\d
  ci_installations`, not by exit code.
- **`agent_runs.source` already has a `'ci'` enum value.**
  `server/src/db/schema/runs.ts:25` — T6's insert needs no schema change here,
  only a schema change on `ci_runs`/`ci_installations` (T2).
- **`ci_installations.agentId` cascades on agent delete; `ci_runs.ci_installation_id`
  sets null.** `server/src/db/schema/ci.ts:6-8,16-18` (current file, read this
  session) — confirms the Edge case in the spec (deleted agent → orphaned
  `ci_runs` rows, AC-28's null-safe fallback) is already structurally
  guaranteed by existing FKs; T7/T8 just need to not assume `ci_installation_id`
  is always present.
- **`agent-runner/src/index.ts` already has the `DEVDIGEST_POST_AS` wiring
  the runner side needs** (`agent-runner/src/index.ts:25-33`, resolves
  `env.DEVDIGEST_POST_AS` to `'github_review'|'pr_comment'|'none'`, defaults
  to `'github_review'`). `agent-runner/insights/INSIGHTS.md`'s "Open
  Questions" entry (2026-07-08) explicitly flags this as unresolved from the
  runner side and says "whoever owns the export/workflow-generation track
  should close this loop." **Resolution for this plan (T3):**
  `workflow.ts` sets `env: { DEVDIGEST_POST_AS: '<configured post_as>' }` as
  a plain static string baked into the generated YAML at export time (never
  a secret, never templated from untrusted input) — this closes the loop
  without touching `AgentManifest`'s schema or `agent-runner/src/index.ts`
  again. Record this as resolved in a follow-up `agent-runner/insights/
  INSIGHTS.md` entry once T3 lands (see Skills below).
- **`agent-runner/CLAUDE.md`'s "Do Not Touch Without Reading" + `agent-runner/
  insights/INSIGHTS.md` must be read in full before any edit to
  `agent-runner/src/context.ts` or `agent-runner/src/artifact.ts` (T10/T11).**
  This is not optional scaffolding — `agent-runner/CLAUDE.md:76-81` names
  `src/index.ts`/`tsconfig.json` explicitly and its "Session Context" section
  requires summarizing the top 3 insights before starting. `context.ts`/
  `artifact.ts` aren't literally on that "Do Not Touch" list, but they feed
  `index.ts`'s call graph directly — read both files first regardless.
  Current shape confirmed this session: `PrContext`
  (`agent-runner/src/context.ts:22-33`) has no SHA field at all;
  `BuildResultArtifactInput`/`buildResultArtifact`
  (`agent-runner/src/artifact.ts:8-14,32-44`) has no `commitSha`/`model`/
  `agentVersion` params — T10/T11 add exactly these, nothing else.
  `agent-runner/CLAUDE.md`'s "Consuming reviewer-core" invariants (grounding
  gate, `wrapUntrusted`/`INJECTION_GUARD`, deterministic gate) are NOT touched
  by T10/T11 — these are pure data-plumbing additions, not pipeline changes.
- **Onion-architecture boundary: `server/src/modules/ci/` and `agent-runner/`
  are separate packages that must never import each other directly.** Both
  consume `@devdigest/shared` (contracts) and `@devdigest/reviewer-core`
  through their own `tsconfig.json` path aliases — never `ci/` importing
  from `agent-runner/src/*`, never `agent-runner/` importing from
  `server/src/modules/ci/*`. `server/CLAUDE.md`'s module-shape convention
  (`routes.ts`+`service.ts`+`repository.ts`, split into `repository/<entity>.repo.ts`
  when it grows) applies to the new `ci/` module; concrete adapters
  (`GitHubClient`) stay resolved through `container.github()`
  (`server/src/platform/container.ts:184-190`), never imported directly by
  `ci/service.ts`. **Architecture-reviewer must check this boundary
  specifically** (explicit user instruction for this plan).
- **Rate-limit convention already established.** `{ config: { rateLimit: {
  max: 10, timeWindow: '1 minute' } } }` on the route options object, exact
  pattern at `server/src/modules/reviews/routes.ts:33,65` (confirmed this
  session) — T9 reuses this literally, not a new limit.
- **`ValidationError` → 422, not 400** (`server/INSIGHTS.md:26-34`) — AC-6's
  "sever (shall) відповісти 400 `unsupported_ci_target`" must be thrown as an
  explicit `AppError` subclass with `statusCode: 400`, not a zod
  `ValidationError`, or the route will silently return 422 instead of the
  AC-mandated 400.
- **`IdParams` (`z.string().uuid()`) validates `:id` before the handler runs**
  (`server/INSIGHTS.md:252-262`) — relevant to `/agents/:id/export-ci` and
  `/agents/:id/ci`, both keyed on an agent UUID.
- **No `db.transaction()` precedent exists yet in `server/src`** except one
  (`server/INSIGHTS.md:86-97`, `conventions/repository.ts:68-81`) — T4's
  "commit files → find/open PR → upsert `ci_installations`" sequence spans a
  GitHub API call (not transactional) and a DB write; AC-21 ("error before
  `ci_installations` write") is satisfied by ordering (GitHub call first,
  DB write only on success), not by wrapping both in one DB transaction —
  don't over-engineer this into a new transaction pattern.
- **Do-not-touch list (root `CLAUDE.md`):** migrations once applied,
  "unused" schema tables, lockfiles, `agent-runner/dist/` — none of T1-T16
  touch these directly except T2's brand-new migration file itself, which is
  the intended new artifact, not an edit to an existing one.

## Skills the implementer will use

- **`onion-architecture`** — for every `server/src/modules/ci/**` file, the
  new `GitHubClient` interface methods (`adapters.ts`), and their
  `octokit.ts`/`mocks.ts` implementations; also governs the
  `ci/` ↔ `agent-runner/` boundary called out in Constraints above.
- **`fastify-best-practices`** — new routes in `ci/routes.ts`
  (`fastify-type-provider-zod` schemas, rate-limit config objects, error
  handling via `AppError` subclasses).
- **`zod`** — porting `AgentManifest`/`AgentManifestInput` (T1), extending
  `CiResultArtifact` (T1), and the manifest round-trip validation in T3.
- **`drizzle-orm-patterns`** + **`postgresql-table-design`** — T2's schema
  edits (`ci.ts`) and the new `uniqueIndex` on
  `(agent_id, repo, target_type)` for AC-4's upsert semantics.
- **`react-ui-architecture`** — placement of `_components/ExportWizard/`
  (per-step subcomponents), `_components/CiTab/`, `_components/CiRunsView/`
  inside `client/src/app/agents/[id]/_components/AgentEditor` / new
  `app/ci-runs/`, per the feature-folder shape in `client/CLAUDE.md`.
- **`react-best-practices`** — wizard step-state management (T12),
  TanStack Query hooks (T15).
- **`security`** — while writing `workflow.ts` (T3): enforce `on:
  pull_request` never `pull_request_target`, no PR-title/body interpolation
  into any `run:` step, pinned `actions/checkout`/`actions/upload-artifact`
  SHAs, secret only via `secrets.OPENROUTER_API_KEY` env, never inline. This
  is the implementer applying the spec's own NFR section while coding — it
  is **not** a substitute for the separate `security`-informed
  architecture-reviewer pass below.
- **`engineering-insights`** — each implementer invokes this at the end of
  their group if they hit something non-obvious (per root `CLAUDE.md`
  session protocol). In particular, whoever does Group A should record the
  `DEVDIGEST_POST_AS` resolution (Constraints above) as a fix/decision entry
  in `agent-runner/insights/INSIGHTS.md`, closing that file's own open
  question.

**Explicitly NOT used in this workflow:** `test-writer` is not part of this
pipeline — no implementer writes new test files (see Test plan below for why
and what replaces it).

## Ordered steps

Five implementer groups, run in this order (each later group depends on
contracts/schema/routes the earlier group(s) establish):

### Group 1 (Implementer 1) — Contracts + DB + agent-runner touches
Covers spec T1, T2, T10, T11.

1. **T1 — contracts.** Port the `AgentManifest`/`AgentManifestInput` block
   verbatim into `client/src/vendor/shared/contracts/eval-ci.ts` (insert
   between `CiFile` and `CiExportInput`, matching the server copy's position
   and doc-comment). Add `commit_sha: z.string().min(1)`, `model:
   z.string()`, `agent_version: z.number().int().nullish()` to
   `CiResultArtifact` in **both** copies. Do not touch any other export in
   either file.
2. **T2 — DB.** Edit `server/src/db/schema/ci.ts`: add `commitSha`, `model`,
   `agentVersion`, `durationS` (`doublePrecision`), `critical`/`warning`/
   `suggestion` (all nullable `integer`) to `ciRuns`; add `workflowVersion`
   (nullable `text`) to `ciInstallations`; add a `uniqueIndex` on
   `ciInstallations(agentId, repo, targetType)`. Generate the migration with
   `node node_modules/drizzle-kit/bin.cjs generate` (not `pnpm db:generate` —
   see Constraints). Verify the migration file's SQL by reading it, and (if
   Docker/Postgres is reachable) apply it and confirm columns via `\d
   ci_runs`/`\d ci_installations` — do not trust exit codes alone (see
   Constraints on the path-with-space guard bug).
3. **Before touching agent-runner:** read `agent-runner/CLAUDE.md` in full
   (especially "Do Not Touch Without Reading" and "Consuming reviewer-core")
   and `agent-runner/insights/INSIGHTS.md` in full. Summarize the top 3
   relevant points before proceeding, per that file's own "Session Context"
   instruction.
4. **T10 — `agent-runner/src/context.ts`.** Add `headSha: string` to
   `PrContext`; resolve it in `resolvePrContext` from
   `event.pull_request.head.sha` first, falling back to `env.GITHUB_SHA` if
   the event payload doesn't have it (mirrors the existing `PR_NUMBER`
   env-then-payload fallback pattern already in the same function). Do not
   change `RunnerError` throwing behavior for the existing required fields.
5. **T11 — `agent-runner/src/artifact.ts`.** Add `commitSha: string`,
   `model: string`, `agentVersion?: number | null` to
   `BuildResultArtifactInput`; thread them into the `candidate` object built
   in `buildResultArtifact` as `commit_sha`/`model`/`agent_version`. No
   change to `severityCounts` or the `RunnerError` fallback branch.
6. Wire the new `PrContext.headSha`/model/agentVersion values through
   wherever `run.ts`/`index.ts` currently calls `buildResultArtifact` (read
   `agent-runner/src/run.ts` first to find the exact call site — do not
   guess the shape) so the new fields are actually populated end-to-end, not
   just typed.
7. Run (not write) `agent-runner`'s existing test suite
   (`agent-runner/src/{manifest,diff,run}.test.ts` per its own INSIGHTS) —
   confirm all 19+ tests still pass after the two edits, since this package
   was explicitly "already tested (19/19)" before this plan touches it.

### Group 2 (Implementer 2) — Server: `ci/` module core (manifest + workflow generation + export routes)
Covers spec T3, T4, and the `export-ci` half of T9.

1. **T3 — new module** `server/src/modules/ci/`: `manifest.ts` (build
   `AgentManifest` from an `agents` row + its linked+enabled skills, slug
   computation with in-export dedup per AC-9, YAML serialization — round-trip
   through `AgentManifest.safeParse` per AC-8), `workflow.ts` (generate
   `.github/workflows/devdigest-review.yml` per AC-11: `on: pull_request`
   only, never `pull_request_target`; `run: node
   .devdigest/runner/index.js`, never `uses: devdigest/review-action@v1`;
   explicit `permissions:` block, `write` on `pull-requests` only when
   `post_as !== 'none'`; pinned full-SHA `actions/checkout`/
   `actions/upload-artifact`; `env: OPENROUTER_API_KEY:
   ${{ secrets.OPENROUTER_API_KEY }}`, and `env: DEVDIGEST_POST_AS:
   '<configured post_as>'` as a plain static string — see Constraints on
   closing the agent-runner open question), `service.ts` (orchestrates
   manifest + workflow + skills-file + empty `memory.jsonl` + the bundled
   `.devdigest/runner/index.js` into the 6-file `CiFile[]` list per G4),
   `repository.ts` (`ci_installations` CRUD/upsert per the new unique
   index). Pick a workflow-version scheme now (open question in the spec,
   decide-and-document here): a hand-maintained constant string exported
   from `workflow.ts` (e.g. `WORKFLOW_GENERATOR_VERSION = '1.0.0'`), bumped
   whenever the generated template changes — not a content hash (a hash
   isn't a human-meaningful "version" for the CI tab's list, AC-33).
2. Locate the bundled runner bytes for the 6th file
   (`.devdigest/runner/index.js`, `editable: false`) — read
   `agent-runner/README.md` and `agent-runner/package.json`'s `build` script
   to confirm exactly where `dist/index.js` lands and whether it's expected
   to already be built in this worktree before `service.ts` can read it; if
   `agent-runner/dist/` isn't present yet (root `CLAUDE.md`'s do-not-touch
   note says it "arrives with the CI-runner lesson" but may need a `pnpm
   build` run first in this worktree), run `pnpm build` inside
   `agent-runner/` to produce it rather than inventing a placeholder.
3. **T4** — `POST /agents/:id/export-ci` in `ci/routes.ts`: `action:
   'files'` (Preview, AC-7/AC-10, no side effects) and `action: 'open_pr'`
   (Install, AC-18-21) using `container.github()`'s already-implemented
   `commitFiles`+`findOpenPr`+`openPullRequest` (branch `devdigest/ci`,
   upsert `ci_installations` only after the GitHub call succeeds — see
   Constraints on ordering vs. transactions). AC-6: throw a `400
   unsupported_ci_target` `AppError` subclass (not a zod `ValidationError`,
   which serializes as 422) when `target !== 'gha'`.
4. **T9 (export-ci half)** — add `config: { rateLimit: { max: 10,
   timeWindow: '1 minute' } }` to the `POST /agents/:id/export-ci` route
   options, matching `reviews/routes.ts:33,65` verbatim.
5. Register the new module in `server/src/modules/index.ts` (one import +
   one entry, per that file's own "ADD A MODULE" instructions).

### Group 3 (Implementer 3) — Server: GitHub API methods + ingest/polling + CI Runs read endpoints
Covers spec T5, T6, T7, T8, and the ingest half of T9.

1. **T5** — add `listWorkflowRunsFor(repo, workflowFile)` and
   `downloadRunArtifact(repo, runId, artifactName)` to the `GitHubClient`
   interface (`server/src/vendor/shared/adapters.ts`), implement in
   `server/src/adapters/github/octokit.ts` (same `withRetry`/`withTimeout`
   wrapping pattern already used by `commitFiles`/`openPullRequest`, read
   those implementations first for the exact shape), and add a mock in
   `server/src/adapters/mocks.ts` following the existing three-part pattern.
2. **T6** — ingest logic in `ci/service.ts` (same file Group 2 created —
   this group's work lands after Group 2's is merged/available):
   `refreshInstallation(installationId)` / `refreshAll(workspaceId)`.
   Decision for the spec's own open "throughput" question: process
   installations **sequentially** (a plain `for` loop with `await`), relying
   on the existing per-route rate limit (T9/AC-34) on the trigger endpoint
   itself for abuse protection — no new background cron/scheduler; the
   client's "auto-refresh" toggle (T14) polls the same on-demand endpoint via
   `refetchInterval`, it does not imply a server-side job. Per run: list
   workflow runs newer than the installation's last persisted `ran_at`,
   download the artifact (`null` → skip per AC-23's best-effort contract),
   `CiResultArtifact.safeParse` (AC-25: invalid → skip, log warning, zero
   writes), compare `commit_sha` against the run's own `head_sha` from the
   GitHub API response — not the JSON's self-reported value (AC-26: mismatch
   → skip, zero writes). On success: upsert `ci_runs` + insert one
   `agent_runs` row with `source: 'ci'`, `workspaceId` resolved via
   `ci_installations.agentId → agents.workspaceId` (join, not a stored
   column — `agent_runs.workspaceId` is `notNull`, `prId: null` since the
   target repo isn't necessarily onboarded into `pull_requests`).
3. **T7** — `GET /ci/runs` (workspace-scoped, filters `since`/`agent_id`/
   `repo`/`status`/`source`; distinct-repo list per AC-30 for the "All
   repos" filter).
4. **T8** — `GET /agents/:id/ci` (installations list + `ci_fail_on`
   passthrough + this agent's run history, same row shape as T7 scoped by
   `WHERE ci_installation_id IN (...)`).
5. **T9 (ingest half)** — same rate-limit config on whichever endpoint
   triggers a refresh (decide the exact route now: `POST /ci/refresh` — a
   workspace-scoped "refresh all installations" trigger, since the spec
   doesn't name one explicitly and AC-24 describes the effect, not the
   route).
6. Register nothing new in `modules/index.ts` here if these routes live in
   the same `ci/routes.ts` plugin Group 2 registered — confirm via reading
   the file, don't double-register.

### Group 4 (Implementer 4) — Client: Export Wizard + agent CI tab
Covers spec T12, T13, and the wizard/tab half of T15/T16.

1. **T12** — `_components/ExportWizard/` under the agent editor's `ci` tab
   folder, four steps (Target/Preview/Configure/Install) reusing
   `ExportWizardSteps` (`client/src/vendor/ui/ExportWizardSteps.tsx`,
   confirmed present and unused this session — pass `step`+`labels` as-is,
   don't modify the component). Target: 4 cards, only GHA clickable
   (AC-5/6). Preview: inline-editable content per file except the runner
   bundle (AC-7/10/12) — memory.jsonl shows "(empty — no memory recorded
   yet)" instead of an editor. Configure: trigger checkboxes with the exact
   defaults (AC-13), Install-button disabled when all three are off
   (AC-14), post_as radio defaulting to `github_review` with a "recommended"
   badge (AC-15), permanently-disabled "Block merge" toggle with the exact
   caption (AC-16), "Secrets expected" showing exactly `OPENROUTER_API_KEY`
   + `GITHUB_TOKEN` (AC-17). Install: PR-vs-zip radio (AC-18), wired to
   T4/T15's mutation.
2. **T13** — add `{ key: "ci", labelKey: "editor.tabs.ci", icon: ... }` to
   `AgentEditor/constants.ts`'s `TABS` (the slot the file's own comment
   already reserves — "Later lessons add CI"); new `_components/CiTab/`:
   Add-to-CI / Update-CI-config button (text depends on whether any
   installation exists, AC-31), read-only "Fail CI on: {ci_fail_on}" with a
   link that switches to the `config` tab (AC-32 — no new state, reads the
   same agent object already in the editor), installations list +
   this-agent's run history (AC-33).
3. **T15 (partial)** — `lib/hooks/ci.ts`: `useExportCi`, `useAgentCi` (the
   two hooks Group 4's components need). Leave `useCiRuns`/`useRefreshCi` to
   Group 5 (same file, additive — coordinate file ownership, don't overwrite
   Group 5's additions if timing overlaps).
4. **T16 (partial)** — new `client/messages/en/ci.json` keys for the wizard
   and the CI tab (Export to CI, step labels, Add to CI / Update CI config,
   Fail CI on, secrets-expected copy, etc.).

### Group 5 (Implementer 5) — Client: CI Runs global page
Covers spec T14 and the CI-Runs half of T15/T16.

1. **T14** — new `client/src/app/ci-runs/page.tsx` (thin) + `_components/
   CiRunsView/`: table with TIMESTAMP/PULL REQUEST/AGENT/SOURCE/DUR./
   FINDINGS/COST/STATUS/Trace columns (AC-28), filters (7 days/agent/repo/
   status/source, repo filter built from `GET /ci/runs`'s distinct list,
   AC-30), "Trace" opens `github_url` in a new tab (`target="_blank"
   rel="noopener"`, AC-29 — no internal drawer), a "Refresh" button plus an
   auto-refresh toggle implemented as a client-side `refetchInterval` on the
   same query (no new server endpoint beyond what Group 3 built). Add the
   nav entry — `activeKeyFor` (`client/src/components/app-shell/helpers.ts`,
   confirmed already has the `ci-runs` branch this session) just needs the
   actual route/page to exist; add the `GLOBAL`-section nav link itself
   wherever the sibling "Multi-Agent Review"/"Agent Performance"/"Memory"
   links are declared (read that file first — don't guess its name).
2. **T15 (remainder)** — `useCiRuns`, `useRefreshCi` in `lib/hooks/ci.ts`
   (coordinate with Group 4 on this shared file).
3. **T16 (remainder)** — `ci.json` keys for the CI Runs page (column
   headers, filter labels, status labels).

### Post-implementation (coordinator-run, not an implementer group)

1. **`architecture-reviewer`** reviews the diff from all 5 groups. Explicit
   focus area for this run (user-mandated): confirm `server/src/modules/ci/**`
   never imports from `agent-runner/src/*` and vice versa — both should only
   share `@devdigest/shared`/`@devdigest/reviewer-core` via their own
   `tsconfig.json` path aliases, never each other directly. Also check the
   onion layering inside `ci/` itself (routes → service → repository;
   `GitHubClient` resolved via `container.github()`, never `new
   OctokitGitHubClient(...)` inside `service.ts`).
2. **`plan-verifier`** checks the implementation against this plan and the
   spec's AC-1 through AC-34 (reading code, not running new tests — see Test
   plan below for why).
3. **Bounded fix loop:** if either review raises findings, dispatch fixer
   subagent(s) to address them — **maximum 2 subagent dispatches total**
   across this entire cycle (not 2 rounds each), per explicit user
   constraint. If findings remain after 2 dispatches, stop and surface the
   remainder to the user rather than continuing to loop.
4. The plan returns to the user for a re-read before any of the above is
   actually launched (explicit user request — do not auto-execute this plan
   immediately after it's written).

## Test plan

**No new test files are written in this workflow.** Per explicit user
instruction (mirroring the sibling SPEC-07/Multi-Agent-Review plan), no
`implementer` in Groups 1-5 writes a test, and `test-writer` is not part of
this pipeline. This is a deliberate, accepted gap against the spec's own
Task checklist, which names specific new test files per task
(`ci-export.it.test.ts`, `ci-manifest.test.ts`, `ci-workflow.test.ts`,
`ci-ingest.it.test.ts`, `ci-runs-list.it.test.ts`, `ExportWizard.test.tsx`,
`CiTab.test.tsx`, `CiRunsView.test.tsx`, etc.) — those files are **not**
created by this plan's execution; `plan-verifier`/`architecture-reviewer`
verify AC compliance by reading code, not by a green test run against new
coverage.

What each implementer group **does** run (to catch regressions against
*existing* coverage, not to add new coverage):

- **Group 1:** `agent-runner`'s own `pnpm typecheck`, `pnpm test`, `pnpm
  build` (its `package.json` scripts per `agent-runner/CLAUDE.md`) — confirm
  the pre-existing 19+ tests still pass after T10/T11's field additions.
  `server`: `pnpm exec vitest run --exclude '**/*.it.test.ts'` (contracts
  fixture tests are hermetic — a required-field addition to a Zod schema can
  break an existing `.parse()` fixture without a type error, per
  `server/INSIGHTS.md:160-172`).
- **Groups 2-3 (server):** `pnpm exec vitest run --exclude
  '**/*.it.test.ts'` (unit) and, if Docker is available,
  `pnpm exec vitest run .it.test` (integration — self-skips without Docker
  per `server/README.md`'s Testing section) after each group's changes, plus
  `pnpm typecheck`.
- **Groups 4-5 (client):** `pnpm test` and `pnpm typecheck` in `client/`
  after each group's changes.

A pass, given no new tests exist yet, means: all pre-existing suites stay
green (no regression), `pnpm typecheck` is clean in every touched package,
and `architecture-reviewer`/`plan-verifier` confirm AC-1 through AC-34 by
reading the implementation directly.

## Out of scope

- **Architecture review** is a separate pipeline stage (`architecture-reviewer`,
  described above) — not something any of the 5 implementers self-certifies.
- **A dedicated security-review pass** is not part of this plan's pipeline;
  the spec's NFR section (`pull_request` vs `pull_request_target`, secret
  handling, injection) is applied by the implementer *while coding* per the
  `security` skill (Skills section above), but that is not equivalent to a
  standalone security-review agent run. If the user wants one, it is a
  separate, explicit step after this plan's pipeline completes.
- **Settings → Integrations, CircleCI/Jenkins/Generic-CLI generators, a real
  GitHub-App-backed "Block merge", the Memory module, a push-model ingest
  endpoint, and an internal `RunTraceDrawer` for CI runs** — all explicit
  Non-goals in SPEC-08, not touched by any group above.
- **A "Remove CI installation" UI control** — left open by the spec (Open
  questions); not built by this plan.
