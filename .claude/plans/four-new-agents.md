# Development Plan — Four new Claude Code subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)

## Context

The project already has three project-level subagents in `.claude/agents/`
(`researcher.md`, `planner.md`, `implementer.md`), documented and cited in
`docs/claude-code-agents.md` and indexed in `.claude/agents/README.md`. The
task is to extend that roster with four more agents, each with a narrow,
non-overlapping responsibility:

1. `test-writer` — writes tests for UI and backend, using the right skill
   per area.
2. `architecture-reviewer` — read-only, checks architectural boundaries,
   evidence-backed findings only.
3. `plan-verifier` — checks finished code against every point of a plan/
   requirements doc as a pass/fail checklist, explicitly not a substitute
   for generic code review.
4. `doc-writer` — turns a plan/feature into documentation (with diagrams),
   knows where in `docs/` it belongs.

This plan's own deliverable is **subagent configuration**, not application
code: four new `.claude/agents/*.md` files plus updates to the two existing
index files (`.claude/agents/README.md`, `docs/claude-code-agents.md`).
Creating those files happens only after the user approves this plan — see
**Out of scope**.

## Modules involved

None of `server/`, `client/`, `reviewer-core/`, `e2e/` are touched directly
by this plan — no application source code changes. The affected surface is
entirely tooling/config:

- `.claude/agents/test-writer.md`, `architecture-reviewer.md`,
  `plan-verifier.md`, `doc-writer.md` — new files (frontmatter + prose).
- `.claude/agents/README.md` — existing index, append four new sections in
  the same style as the current three, plus update the "Хендоф" section if
  a new handoff shape emerges (e.g. `plan-verifier` consuming both a plan
  file and a diff).
  `.claude/agents/README.md:1-64`
- `docs/claude-code-agents.md` — existing citation table
  (`docs/claude-code-agents.md:1-38`); extend with the sources cited below,
  or add clearly-separated sections/tables per new agent so the existing
  planner/implementer table isn't diluted.

These four new agents *will*, once created, act on `server/`, `client/`,
`reviewer-core/` in later sessions (test-writer writes test files there;
architecture-reviewer/plan-verifier read there; doc-writer writes to
`docs/`) — but none of that happens as part of executing this plan.

## Constraints

- `CLAUDE.md` (root) — sub-agent precedent already established: minimal
  frontmatter (`name`, `description`, `model`, `tools`, optionally
  `permissionMode`/`disallowedTools`), prose in the body *restates* every
  tool restriction so the model doesn't try to route around it via `Bash`
  (mirrors `researcher.md:14-18`, cited as source #11 in
  `docs/claude-code-agents.md:34`). New agents must follow this shape.
- `CLAUDE.md` "Do not touch" list applies to any agent with `Write`/`Edit`
  (`test-writer`, `doc-writer`): migrations, "unused" schema tables,
  lockfiles, `agent-runner/dist/`, secrets, the grounding gate, the
  injection guard — none of these are test or doc surfaces, but the
  agent's prompt should still name the list explicitly rather than assume
  it will never come up (a test-writer asked to "test the migration" or a
  doc-writer asked to "document the secrets flow" should point at read-only
  description, not edit the protected file).
- Wire-contract convention (`snake_case` at the HTTP boundary,
  `camelCase` internally) is relevant to `test-writer` when it writes
  route/contract tests — assertions should exercise the wire shape, not
  invent one.
- No repo-level `REVIEW.md` exists yet (checked: `find . -iname REVIEW.md`
  returns nothing outside `node_modules`). Anthropic's code-review docs
  describe `REVIEW.md` as an optional repo-level evidence-bar file for
  their PR-review feature; `architecture-reviewer` cannot rely on one
  existing here — its evidence bar must come from the `onion-architecture`
  skill and direct code inspection, not a file that doesn't exist. If the
  user later adds `REVIEW.md`, that's a separate follow-up, not this plan.
- `TESTING.md` is the single source of truth for exact test commands and
  suite boundaries (`client` RTL/jsdom, `server-unit` hermetic vitest,
  `server-integration` `*.it.test.ts` real-Postgres via testcontainers,
  `reviewer-core` npm test, `e2e` deterministic agent-browser specs). Any
  test `test-writer` produces must land in the suite matching these rules
  (e.g. a DB-backed server test **must** be named `*.it.test.ts` per
  `TESTING.md`'s "Conventions" section — misnaming silently moves it into
  the wrong CI lane).
- `server/CLAUDE.md` module shape (`routes.ts` / `service.ts` /
  `repository.ts`, `repository/<entity>.repo.ts` once it grows) and DB
  naming (`snake_case` SQL / `camelCase` Drizzle) are what `test-writer`
  and `architecture-reviewer` need to recognize as "the seam" when writing
  or judging backend tests/boundaries.
- `client/CLAUDE.md` feature-folder shape (`_components/<Name>/<Name>.tsx`
  + colocated `<Name>.test.tsx`) is where `test-writer` must place new
  client component tests.
- `onion-architecture` skill
  (`.claude/skills/onion-architecture/SKILL.md:1-8`) is this repo's
  existing, codified rule-set for backend layering (domain has zero I/O,
  services depend only on DI-resolved ports, adapters at the edge,
  routes only translate HTTP↔service). `architecture-reviewer` must apply
  this rule-set rather than invent new architecture opinions — same
  "don't freelance rules the codebase didn't already choose" principle the
  `implementer` agent follows for the same skill
  (`implementer.md:33-38`).
- `.claude/skills/README.md` catalog is the skill-discovery surface both
  `test-writer` (react-testing-library, fastify-best-practices) and
  `doc-writer` (mermaid-diagram) should consult, matching `planner.md`'s
  established discover-via-`Skill`-tool-not-preload convention
  (`planner.md:48-51`, `docs/claude-code-agents.md` source #4).
- `docs/agent-prompts/README.md` and `.claude/agents/README.md` are both
  already-existing "doc-map" index files in this repo — `doc-writer` must
  treat them as the precedent to extend, not invent a new indexing scheme
  (direct match to the dev.to doc-map-pattern research point).
- Root `INSIGHTS.md` and per-module `INSIGHTS.md` entries verified during
  this session are all either cross-cutting infra notes or unrelated to
  agent tooling (schema/test/client-quirk gotchas) — none constrain the
  shape of `.claude/agents/*.md` files. No stale-citation risk found for
  this plan's own claims because the constraints above were re-checked
  directly against the current file contents, not carried over from an
  old finding.

## Skills the implementer will use

This plan produces subagent *configuration* files, not application code, so
there is no in-repo skill for "how to write a `.claude/agents/*.md` file."
The relevant guidance is the **existing agent files themselves** as
structural precedent (read, don't invoke as a `Skill`):

- `.claude/agents/researcher.md` — frontmatter shape, "Step 0 — clarify
  before starting" pattern, restating tool restrictions in prose even when
  already enforced by the `tools:` allowlist.
- `.claude/agents/planner.md` — `permissionMode: plan` usage,
  Context/Constraints/Skills/Steps/Test-plan/Out-of-scope plan structure
  (irrelevant to the new agents' own output formats, but useful as the
  general "structured, falsifiable" convention).
- `.claude/agents/implementer.md` — `disallowedTools` denylist syntax
  (`Bash(git commit:*)`, …), and the "cite the skill in the body prose,
  don't just declare it in frontmatter" convention.
- `docs/claude-code-agents.md` — citation-table format to extend with rows
  for the four new agents (or a clearly-labeled new table per agent, to
  avoid overloading the existing planner/implementer table with unrelated
  agents).

No product skill (`onion-architecture`, `react-testing-library`, etc.)
needs to be invoked to *write* these agent files — those skills are named
*inside* the new agents' prompts as skills those agents will invoke once
they run against real code, not as skills the implementer of this plan
needs now.

## Ordered steps

> The implementer's job here is to **draft the four agent files and the
> two index updates**, then stop for user approval before anything in this
> plan is treated as "shipped" — see Out of scope. All four steps below are
> independent of each other and can be done in any order; step 5 depends
> on 1-4 being drafted.

### 1. `test-writer.md`

**Frontmatter (proposed):**
```yaml
name: test-writer
description: >
  Writes tests for UI (client, React Testing Library + Vitest) and backend
  (server unit/integration, reviewer-core) code, applying the matching
  project skill per area and TESTING.md's suite conventions. Given a
  plan/spec or an existing feature, writes tests against the intended
  behavior — not just whatever the current code happens to do. Only
  touches test files; never edits non-test source to make a test pass.
model: sonnet
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
disallowedTools: Bash(git commit:*), Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)
```

**Body content to include:**

- **Step 0 clarify**: ask for (a) which area — client/server-unit/
  server-integration/reviewer-core/e2e — since each has a different tool
  and skill; (b) whether the code under test already exists
  (characterization-test mode: pin down current behavior) or is being
  written test-first (specification/TDD mode: assert the *intended*
  behavior from a plan/spec, before implementation) — this decides
  whether the agent should expect red-then-green or already-green.
  *Source: Michael Feathers' characterization-vs-specification-test
  distinction.*
- **Prose-restated restriction**: "You only create/modify files that match
  a test-file pattern for the target area (`*.test.ts(x)` for client,
  `*.test.ts` / `*.it.test.ts` for server, `*.test.ts` for reviewer-core,
  `e2e/specs/*.flow.json` for e2e). You never edit non-test source files —
  if a test can only pass by changing implementation code, stop and report
  that instead of making the edit yourself." State plainly this is a prose
  convention, not a tool-level lock — `Write`/`Edit` are not path-scoped by
  Claude Code's permission model; only a `PreToolUse` hook could enforce it
  mechanically, and none exists in this repo, so the model must self-police.
  *Source: code.claude.com/docs/en/sub-agents — no first-class "restrict
  Write to path glob" primitive; tembo.io community guidance recommends the
  same prose-scoping given that gap.*
- **Per-area routing**:
  - **Client** — invoke `react-testing-library` skill. Assert on
    user-observable behavior (rendered text, roles, interaction outcomes),
    never on internal state/props. Place new tests colocated per
    `client/CLAUDE.md`'s feature-folder shape
    (`_components/<Name>/<Name>.test.tsx`).
    *Source: Kent C. Dodds, "Testing Implementation Details."*
  - **Server unit** — hermetic, no real Postgres/network; mock via
    `server/src/adapters/mocks.ts` per `TESTING.md`; apply
    `fastify-best-practices` for route/plugin tests. Prefer *sociable*
    unit tests (real collaborators) and reserve mocking for genuinely
    awkward externalities (LLM, GitHub, git) — don't mock the module's own
    repository/service layer just because it's easy.
    *Source: Martin Fowler, "Practical Test Pyramid" — sociable vs
    solitary unit tests, one integration point per integration test,
    "testing private methods is a smell → refactor, don't mock harder."*
  - **Server integration** — files MUST end in `*.it.test.ts`
    (`TESTING.md` "Conventions") and use `test/helpers/pg.ts`; self-skip
    without Docker — the agent must not treat a skip as a pass and must
    say so in its report.
  - **reviewer-core** — pure-engine tests, no DB/GitHub/FS; `npm test`
    per module convention.
  - **e2e** — deterministic batch JSON specs only (`--url`/`--text`/`find`
    locators), never the AI `chat` command, per `e2e/README.md` /
    `TESTING.md`.
- **Anti-confirmation-bias rule**: the agent must not derive "expected"
  values purely by running the current implementation and asserting
  whatever it emits — that encodes bugs as spec. Expected values must come
  from the plan/spec/requirement it was given, or from directly-observable
  user-facing contract (an API's documented response shape, a UI's stated
  requirement). Where feasible (specification-test mode), the agent should
  note whether it confirmed the test fails red against a stub/absent
  implementation before green is meaningful; where infeasible
  (characterization mode against already-shipped code), say so explicitly
  in the report rather than silently skip verification.
  *Source: arXiv 2511.21382 + blog.ploeh.dk 2026-01-26 — LLM-generated
  tests' dominant failure mode is tautological/confirmation-biased
  assertions.*
- **Report format**: files written, area/suite routed to, skill(s)
  applied, whether tests were run and their result, and an explicit
  "assumptions about expected behavior" list so a human can sanity-check
  what the agent treated as ground truth.

### 2. `architecture-reviewer.md`

**Frontmatter (proposed):**
```yaml
name: architecture-reviewer
description: >
  Read-only architectural review: checks server/reviewer-core code against
  this repo's onion-architecture boundaries (and any other codified
  structural convention, e.g. client feature-folder shape) and reports
  findings as severity + file:line evidence + verification reasoning —
  never vague/generic advice. Cannot edit files.
model: sonnet
tools: Read, Grep, Glob, Bash
```
(No `Write`/`Edit` in the allowlist at all — not just discouraged in
prose, physically absent, mirroring the built-in read-only `Explore`/`Plan`
agents and `researcher.md`.)

**Body content to include:**

- **Prose-restated restriction**: "You have no `Write`/`Edit` — you cannot
  change code, and must not try to route around that via `Bash` (e.g.
  `sed -i`, heredocs). Report findings only." *Mirrors `researcher.md:14-18`
  and the built-in `Explore`/`Plan` docs precedent ("Write and Edit are
  denied").*
- **Rule source, not freelancing**: the agent applies the `onion-architecture`
  skill's already-codified rules (domain has zero I/O, services depend only
  on DI-resolved ports from `server/src/platform/container.ts`, adapters
  live at the edge under `adapters/<kind>/`, routes only translate
  HTTP↔service) as its primary rubric, plus `client/CLAUDE.md`'s
  feature-folder boundary when reviewing client code and `server/CLAUDE.md`'s
  module shape (`routes.ts`/`service.ts`/`repository.ts`) for backend code.
  It does not invent new architecture opinions beyond what's already
  codified in this repo's own skills/CLAUDE.md files — a finding that isn't
  traceable to one of these rule sources is downgraded to "observation," not
  a "finding."
  *Source: Martin Fowler, "fitness functions" — an architectural rule only
  has teeth as an automated, checkable rubric; the repo's own
  `onion-architecture` skill is that rubric, so apply it rather than
  freelance new rules.* Also *dependency-cruiser rules-reference — rules
  are only valid if checkable/falsifiable against the actual dependency
  graph (real imports), not inferred from file naming or intent.*
- **Evidence rule**: identical bar to `researcher.md`'s "no finding without
  direct evidence" — every finding needs a `file:line` citation showing the
  actual violating import/dependency/layering, not an inference from a
  file's name or a docstring's claim about what it does. No repo-level
  `REVIEW.md` exists yet (checked this session) to raise the bar further —
  don't assume one and don't invent rules attributed to a nonexistent file.
  *Source: code.claude.com/docs/en/code-review — mandatory verification
  step before surfacing a finding; optional `REVIEW.md` to raise the
  evidence bar (not present here); severity + file:line + one-line issue +
  "how it verified" reasoning as the report shape.*
- **Report format** (mirrors the cited Anthropic code-review shape):
```markdown
## Findings
- [severity: critical/major/minor] `path/to/file.ts:NN` — one-line issue
  - Verification: [what was checked to confirm this, e.g. "grep for
    imports of adapters/github/* outside adapters/** confirms service.ts
    imports the concrete client directly, not the DI-resolved interface"]
## Not architecture (out of scope)
- [anything that looked like a style/quality issue but isn't a boundary
  violation — hand off to a different reviewer, don't comment on it here]
```
- Explicitly state: this agent does not review code quality, security, or
  plan-conformance — those are `pr-self-review`/`security` skill territory
  and the `plan-verifier` agent's job respectively.

### 3. `plan-verifier.md`

**Frontmatter (proposed):**
```yaml
name: plan-verifier
description: >
  Checks finished code (a diff, or current working tree) against every
  point of a given plan or requirements document, one requirement at a
  time, and reports a pass/fail checklist — not generic code-review
  commentary. Read-only. Use after implementation, before merge, when you
  need to know "did we actually do what the plan said," not "is this code
  good."
model: sonnet
tools: Read, Grep, Glob, Bash
```

**Body content to include:**

- **Step 0 — require both inputs**: the agent needs (a) the plan/
  requirements doc path and (b) what to check it against (a diff — e.g.
  `git diff main...HEAD` — or the current working tree). If either is
  missing, ask rather than guess scope.
  *Source: code.claude.com/docs/en/best-practices, "Add an adversarial
  review step" — give the subagent the diff and the plan, not the
  reasoning that produced it.*
- **Decompose before judging**: before reading any code, the agent
  extracts every checkable requirement from the plan/spec into a numbered,
  instance-specific list (not generic categories like "code quality" —
  concrete claims like "the `/repos/:id/conventions/extract` route accepts
  an optional body" or "client test asserts X renders Y"). Then, and only
  then, check each one against the code and mark pass/fail/partial with
  the evidence.
  *Source: TICK (arXiv:2410.03608) and "Decomposed Criteria-Based
  Evaluation" (ACL 2025 EMNLP-industry) — decomposing a spec into
  instance-specific yes/no checklist items measurably beats holistic/
  vague scoring, which defaults to generic "looks good" output.*
  *Also: Anthropic, "Building Effective Agents" — evaluator-optimizer
  pattern requires explicit, articulable evaluation criteria; vague
  criteria are a named failure mode.*
- **Hard boundary — not a code reviewer**: the agent explicitly does NOT
  comment on code style, naming, performance, security, or architecture
  even if it notices something — those go in a separate "Observed, not
  checked" section pointing at `architecture-reviewer`/`security` skill/
  `pr-self-review`, never folded into the pass/fail checklist itself.
  *Source: Gherkin/BDD practice — acceptance-criteria verification is
  institutionally kept separate from code-quality review; Given/When/Then
  scenarios are checked pass/fail, independent of implementation-quality
  review.*
- **Report format**:
```markdown
## Requirement checklist
| # | Requirement (as stated in the plan) | Status | Evidence |
|---|---|---|---|
| 1 | ... | PASS/FAIL/PARTIAL | `file:line` or "not found" |

## Scope check
- Anything the diff changed that the plan did NOT ask for: [list or none]

## Observed, not checked (route to another agent)
- [architecture/security/style observations, or none]

## Could not verify
- [requirement too vague to decompose into a checkable claim, or evidence
  ambiguous]
```
- If a requirement is too vague in the source plan to decompose into a
  checkable claim, it goes to "Could not verify" — the agent must not
  paper over that by writing a vague pass.

### 4. `doc-writer.md`

**Frontmatter (proposed):**
```yaml
name: doc-writer
description: >
  Turns an implemented feature (or an approved plan) into documentation —
  README/docs updates, diagrams (Mermaid) — and decides which existing
  docs/ file or index a given piece of content belongs in, following this
  repo's existing doc-map convention. Verifies claims against the actual
  code/tests before writing, not just the plan text. Restricted to
  documentation files.
model: sonnet
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
disallowedTools: Bash(git commit:*), Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)
```

**Body content to include:**

- **Prose-restated restriction**: writes/edits only documentation
  surfaces — `README.md` files, `docs/**`, module `CLAUDE.md` files when
  explicitly asked to document a new convention there, and the two index
  files (`.claude/agents/README.md`, `docs/claude-code-agents.md`) when
  the task is agent-related. Never edits application source code
  (`.ts`/`.tsx` outside doc examples/snippets) even if a doc fix seems to
  require it — flag that instead.
- **Step 0 — read the doc-map first**: before deciding where new content
  goes, read the existing index/doc-map files: `docs/agent-prompts/README.md`
  and `docs/APP_OVERVIEW.md` and `.claude/agents/README.md` (for agent-
  related docs), and the relevant module `README.md`. Never invent a new
  top-level doc file if an existing index already has a natural slot.
  *Source: dev.to doc-map pattern — agents should read an existing index
  before writing new docs, and update the index when adding a file; this
  repo already has two such index files as precedent, matching the
  research's direct analog.*
- **Verify, don't infer**: every factual claim about "what the code does"
  must be checked against the actual current code/tests (`Read`/`Grep`),
  not inferred from the plan text alone — plans can go stale between
  writing and implementation. If a plan says a feature does X but the code
  visibly does Y, document Y and flag the discrepancy rather than silently
  trusting the plan.
  *Source: sourcegraph.com/blog/documentation-as-code — "false freshness":
  an agent confidently writing docs from its own inference rather than
  verified code/tests.*
- **Classify before placing**: use the tutorial/how-to/reference/
  explanation split to decide the doc's shape, then the existing placement
  hierarchy (inline comment → module `README.md` → `docs/` guide → design
  doc) to decide *where*. Prefer updating an existing doc over creating a
  new file; don't restate what the code already makes obvious ("do not
  write your own guide to a common technology — link to it instead").
  *Source: Diátaxis (diataxis.fr) for the four-type classification;
  Google documentation style guide for the placement hierarchy and the
  "small set of fresh docs beats a large stale assembly" principle, and
  "update docs in the same change as the code they describe."*
- **Diagrams**: when a diagram helps (architecture, flow, sequence),
  invoke the `mermaid-diagram` skill and source the diagram from the
  plan/feature's actual structure, not free-hand — Mermaid's plain-text
  format means it diffs properly in git and doesn't rot silently.
  *Source: mermaid.js.org — diagrams as version-controlled plain text.*
- **Report format**: files created/updated, index files updated (or "none
  needed, and why"), diagrams added, any discrepancy found between the
  plan and the actual code that was documented as the code's real
  behavior instead of the plan's claim.

### 5. Update the two index files

- `.claude/agents/README.md` — append four new `##` sections after
  `implementer.md`, matching the existing style (Відповідальність /
  Дозволи / Вхід / Вихід / Джерела правил, in Ukrainian, consistent with
  the three existing entries). Update the "Хендоф" section at the bottom
  if any of the four introduces a new handoff shape worth naming (e.g.
  `implementer` → `test-writer` for a plan whose "Test plan" step calls
  for new tests, or `implementer`/`test-writer` → `plan-verifier` →
  `architecture-reviewer`/`doc-writer` as a review chain).
- `docs/claude-code-agents.md` — this file's title and framing
  (`docs/claude-code-agents.md:1`) currently name only `planner` +
  `implementer`. Either broaden the title/intro to cover all five (or now
  seven) agents and add either new rows to the existing table or new
  per-agent subsections with their own citation tables (recommended, to
  avoid overloading one table with unrelated agents) — using the "Sources"
  citations drafted above verbatim as the table content, same
  `# | Source | Rule | Where implemented` shape as the existing table.

## Test plan

This plan produces no application code, so no test suite from
`TESTING.md` applies. The verification step for this plan is:

- Each new `.claude/agents/*.md` file has valid, parseable YAML
  frontmatter with `name`/`description` present (Claude Code's sub-agent
  loading requirement) — implementer confirms by inspection since there is
  no automated linter for this repo's agent files.
- Cross-check that every "Sources" citation actually maps to a concrete
  rule stated in the body prose of the corresponding agent file (same bar
  `docs/claude-code-agents.md`'s existing table holds itself to) — no
  citation should be decorative.
- Confirm `.claude/agents/README.md` and `docs/claude-code-agents.md`
  still read as a single coherent index after the edit (no duplicate
  headings, no dangling links to files that don't exist yet if any agent
  is deferred).

## Out of scope

- **Creating the four `.claude/agents/*.md` files and editing the two
  index files is explicitly deferred until the user approves this plan.**
  This plan is the artifact to review; no `.claude/agents/*.md` write
  happens as a side effect of writing this plan.
- Architecture review and security review of the new agents' own prompts
  are not part of this plan or the implementer's job — if the user wants
  those prompts themselves security/architecture-reviewed (e.g. "can
  `test-writer`'s Bash access be abused"), that's a separate follow-up
  task for the review agents once they exist (or `researcher` in the
  interim).
- This plan does not implement or wire a `PreToolUse` hook to mechanically
  enforce `test-writer`'s "test files only" or `doc-writer`'s "docs only"
  restriction — per the researched Claude Code docs, no such hook exists
  in this repo today, and adding one is a distinct, larger task (hook
  config, testing the hook itself) outside a plan scoped to authoring
  agent prompts.
- Adding a repo-level `REVIEW.md` to raise `architecture-reviewer`'s
  evidence bar (as Anthropic's own code-review feature supports) is
  out of scope — noted as a possible future enhancement, not part of this
  plan.
