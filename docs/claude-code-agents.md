# Claude Code subagents: `researcher`, `spec-creator`, `implementation-planner`, `implementer`, `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

> These are Claude Code subagents (`.claude/agents/*.md`), not the in-app
> reviewer agents seeded into Postgres by `server/src/db/seed.ts` and
> documented in [`docs/agent-prompts/`](./agent-prompts/README.md). The two
> systems share the word "agent" but are otherwise unrelated — this file is
> about the former only.

Definitions: [`.claude/agents/researcher.md`](../.claude/agents/researcher.md),
[`.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md),
[`.claude/agents/implementation-planner.md`](../.claude/agents/implementation-planner.md),
[`.claude/agents/implementer.md`](../.claude/agents/implementer.md),
[`.claude/agents/test-writer.md`](../.claude/agents/test-writer.md),
[`.claude/agents/architecture-reviewer.md`](../.claude/agents/architecture-reviewer.md),
[`.claude/agents/plan-verifier.md`](../.claude/agents/plan-verifier.md),
[`.claude/agents/doc-writer.md`](../.claude/agents/doc-writer.md).

`implementation-planner` reviews the requirements for a task, asks
clarifying questions where something is unclear, and surfaces a
`> **Recommendation:**` when a materially better approach exists — then
reads module boundaries, `INSIGHTS.md`, `CLAUDE.md` constraints, and the
`.claude/skills/` catalog to produce a structured Development Plan at
`.claude/plans/<slug>.md`, including which skills apply, so the plan can't
drift from implementation rules. Before finalizing that plan it always asks
the user to pick an execution mode: a **multi-agent** handoff
(`implementation-planner` → `implementer` → optionally `test-writer` →
`plan-verifier`) or a **single agent** doing research, implementation, and
verification itself in one pass — the answer changes what the plan document
contains. It never writes specifications/acceptance-criteria documents and
never implements or executes anything itself. In multi-agent mode,
`implementer` executes that plan across frontend/backend, applies the named
skills, runs the tests from `TESTING.md`, and verifies only its own changes
— architecture and security review are out of scope, owned by separate
agents.

`spec-creator` sits ahead of `implementation-planner` in a Spec Driven
Development flow and, as of the 2026-08-11 workflow audit, is wired to it:
passing a `SPEC-NN` path to `implementation-planner` skips its module/
definition-of-done clarifying questions (row #14 in the table below) — see
its own citation table further down. It writes two kinds of document: an
architectural spec
(`docs/specs/<module>/architecture.md` or the cross-cutting
`docs/specs/architecture.md` — module boundaries, contracts, data flow,
stack, invariants, edited in place) and a feature spec
(`docs/specs/<module>/SPEC-NN-<slug>.md` — one behavior change, EARS-style
`AC-N` acceptance criteria). It asks blocking questions exactly once up
front (spec type, module, design source, supersedes), then runs the task
through six clarification categories and a design-gap/UX pass, folding
anything still unresolved into `[NEEDS CLARIFICATION]` markers instead of
asking again. It has no `Task`/`Agent` tool — when real investigation is
needed it lists the questions under `## Research needed` and the
orchestrating session dispatches `researcher` subagents (in parallel, one
per question) to answer them.

The sections below extend this roster with five more narrow-scope agents:
`spec-creator` (writes specs, not plans), `test-writer` (writes tests per
area/skill), `architecture-reviewer` (read-only, onion-architecture boundary
checks), `plan-verifier` (pass/fail checklist against a plan, not generic
review), and `doc-writer` (turns a plan/feature into documentation). Each
gets its own citation table below rather than being folded into the
implementation-planner/implementer table above, so unrelated agents' sources
don't get diluted together.

## Practices applied, with sources — `implementation-planner` + `implementer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | Anthropic, [`code.claude.com/docs/en/sub-agents`](https://code.claude.com/docs/en/sub-agents) — frontmatter table: only `name`/`description` required, plus `tools` as an allowlist | Minimal correct frontmatter with an explicit `tools:` list instead of inheriting the full tool pool | `implementation-planner.md:2-16`, `implementer.md:2-12` |
| 2 | Anthropic, sub-agents docs, built-in **Plan** agent: "read-only agent... Write and Edit are denied" | The implementation planner is read-only with one exception — the plan file | `implementation-planner.md:16` (`permissionMode: plan`), reinforced in prose at `implementation-planner.md:26-27, 163-166` |
| 3 | Anthropic, sub-agents docs, `disallowedTools` — a denylist applied on top of the allowed pool, evaluated first | Implementer gets full Read/Write/Edit/Bash but with mutating git commands explicitly blocked | `implementer.md:12` (`disallowedTools: Bash(git commit:*), Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)`), reinforced at `implementer.md:24-26` |
| 4 | Anthropic, skills docs, "Preload skills into subagents" vs. on-demand discovery via the `Skill` tool | Don't preload full skill bodies into the implementation planner up front (expensive, unnecessary) — read catalog descriptions and open a specific skill via `Skill` only when it's load-bearing for a plan decision | `implementation-planner.md:77-80` |
| 5 | Anthropic, sub-agents docs, "Chain subagents" — one subagent finishes and returns results, the orchestrator passes context to the next | Plan → implementation handoff via a file artifact rather than session memory (multi-agent mode) | `implementation-planner.md:105-108` (writes `.claude/plans/<slug>.md`) + `implementer.md:28-31` (Step 0 reads that file, asks for a path if none given) |
| 6 | lucumr.pocoo.org, ["What Actually Is Claude Code's Plan Mode?"](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/) — durable-artifact-as-interface-between-stages pattern (research → plan → implementation, each agent's context stays clean) | Fixed plan-file structure as the contract between agents (Context/Constraints/Skills/Steps/Test plan/Out of scope), not free-form text | `implementation-planner.md:110-152`, especially `implementation-planner.md:127-133` ("Skills the implementer will use" / "Skills to apply" — the direct answer to "plan must not conflict with implementation rules") |
| 7 | LangChain, ["Plan-and-Execute Agents"](https://www.langchain.com/blog/plan-and-execute-agents) / [emergentmind.com, Planner-Executor Agentic Framework](https://www.emergentmind.com/topics/planner-executor-agentic-framework) — planner decides "what", executor decides "how"; role separation works best with distinct tool access + explicit handoff artifacts | The implementation planner has no `Edit`/`Write` on source (read-only + one file); implementer has full code access but doesn't re-decide architecture — it executes an already-approved plan | `implementation-planner.md:15-16` (tools) vs. `implementer.md:11-12`; stated in prose at `implementer.md:17-22` |
| 8 | Same planner/executor literature — verification kept separate from implementation | Implementer checks only plan-conformance and test pass/fail; explicitly no architecture or security verdict | `implementer.md:88-101` |
| 9 | Project `CLAUDE.md` ("Session protocol": read `INSIGHTS.md` before touching a module, verify cited `file:line` still holds) | Both agents must read the relevant `INSIGHTS.md` and check citations for staleness | `implementation-planner.md:70-73`, `implementer.md:34-35` |
| 10 | Project `CLAUDE.md` ("After a task that taught you something non-obvious... invoke `engineering-insights`") | Implementer invokes `engineering-insights` at the end of a non-trivial session | `implementer.md:103-107` |
| 11 | Existing `.claude/agents/researcher.md` (in-repo precedent, not an external source) — `Role → Step 0 clarify → …` structure, restrictions stated in prose as well as in config so the model doesn't try to route around them via `Bash` | Both files mirror this structure and restate their tool restrictions in prose | `implementation-planner.md:19-27, 163-166`; `implementer.md:15-26` |
| 12 | User request (this session) — no prior repo precedent for a single-agent-vs-multi-agent execution choice | Before writing the plan, always ask the user to pick multi-agent handoff vs. single-agent pass, and record the choice as an `**Execution mode:**` line in the plan; also review requirements and surface a `> **Recommendation:**` when a materially better approach exists, instead of just transcribing what was asked | `implementation-planner.md:85-101` (Step 1.5), `implementation-planner.md:113` (Execution mode line in the plan template) |
| 13 | `.claude/plans/agent-orchestration-token-efficiency.md` (root cause: implementer manually simulated `pnpm typecheck` output when it reported no Bash, instead of stating the limitation — the single largest measured token cost in that session) | Prefer the plan's exact named test command over a blanket `pnpm test` (avoids an unneeded Docker/testcontainers spin-up); redirect verbose output to a scratch file and read back only the summary/failures; if Bash is unavailable, say so and stop rather than hand-simulating a command's output | `implementer.md:70-86` |
| 14 | 2026-08-11 workflow audit (this session) — spec-creator now exists upstream of implementation-planner | If given a `spec-creator` output path (`docs/specs/<module>/SPEC-NN-*.md`), skip the module/definition-of-done clarifying questions in Step 0 (the spec already answers them) and read the spec as the primary Step 1 source | `implementation-planner.md:41-47` (Step 0), `implementation-planner.md:62-66` (Step 1, item 0) |

**Not confirmed by official documentation** — flagged by the `researcher`
subagent as "could not determine": there is no Anthropic-documented pattern
specifically named "implementation-planner/implementer with mutual skill
awareness," and no documented precedent for the single-agent-vs-multi-agent
question introduced in row #12, nor for the spec-creator wiring in row #14.
The `## Skills the implementer will use` / `## Skills to apply` plan section
(`implementation-planner.md:127-133`) is a design inference combining rows
#4 and #6 above, not a direct citation.

## Practices applied, with sources — `spec-creator`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | Mavin, Wilkinson, Harwood, Novak — "Easy Approach to Requirements Syntax (EARS)", IEEE RE'09 (2009) | Every `AC-N` must match one of the five EARS shapes (ubiquitous, event-driven, state-driven, unwanted behavior, optional feature), each phrased with "shall" | `spec-creator.md:134-145` (reference), checked again at `spec-creator.md:219` (self-check) |
| 2 | User-supplied feature-spec template and architectural-spec description (this session, no prior repo precedent) | Two fixed document shapes — architectural spec (long-lived, edited in place, no per-change numbering) vs. feature spec (`SPEC-NN`, one behavior change, EARS `AC-N`, task checklist) — kept as separate templates because their lifecycles differ | `spec-creator.md:49-132` |
| 3 | code.claude.com/docs/en/sub-agents — no first-class "restrict Write to path glob" primitive; same gap `doc-writer.md`/`test-writer.md` already work around | "Only `docs/specs/**`" is a prose convention, not a tool-level lock — no `PreToolUse` hook enforces it in this repo | `spec-creator.md:30-45` ("Non-goals") |
| 4 | Anthropic, sub-agents docs, "Chain subagents" — same ask-and-relay pattern already used by `implementation-planner`'s clarifying questions, rather than a new nested-dispatch mechanism | No `Task`/`Agent` tool in the allowlist; unresolved research is listed under `## Research needed` for the orchestrating session to fan out to `researcher` subagents in parallel | `spec-creator.md:19` (tools, no `Task`/`Agent`), `spec-creator.md:178-185` (Step 1) |
| 5 | Project `CLAUDE.md` ("Session protocol": read `INSIGHTS.md` before touching a module) — narrowed per this session's explicit instruction to avoid a blanket read | Reads root `INSIGHTS.md` plus only the target module's `INSIGHTS.md`, never every module's | `spec-creator.md:169-171` |
| 6 | User request (this session) — block once, then inline | Step 0 is the only blocking gate (spec type, module, design source, supersedes); everything else unresolved after the six-category analysis becomes an inline `[NEEDS CLARIFICATION]` marker instead of another question round | `spec-creator.md:147-162` (Step 0), `spec-creator.md:204-206` (Step 2) |
| 7 | User request (this session) — traceability and a final self-check, modeled on this file's own `plan-verifier` decomposition practice (row-for-row analog, not a shared source) | Every `AC-N` traces to a Goal/User story, every Edge case maps to an `AC-N` or an open question, every task cites an `AC-N` and a test name — verified in an explicit Step 4 before the draft is returned | `spec-creator.md:208-223` |
| 8 | 2026-08-11 workflow audit (this session) — spec-creator had `Skill` in its tools but nothing forced it to actually call the tool | Data flow in an architecture spec invokes `mermaid-diagram` for real (not just prose) once more than two components are involved; NFR/Untrusted-inputs writing invokes `security` via the `Skill` tool for real when untrusted content is in scope, not just a citation of its name | `spec-creator.md:88-91` (Data flow), `spec-creator.md:224-229` (Step 4) |

**Not confirmed by official documentation** — there is no Anthropic-documented
pattern for a spec-producing agent feeding a plan-producing agent in this
specific shape; rows #2, #6, #7, and #8 are this session's design decisions,
not external citations. EARS itself (row #1) is an established, cited
academic technique, not an inference.

## Practices applied, with sources — `test-writer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | Michael Feathers, characterization-vs-specification-test distinction | Step 0 asks whether the code under test already exists (characterization mode) or is being written test-first from a plan/spec (specification/TDD mode) — this decides expected red-then-green vs. already-green | `test-writer.md` Step 0 — clarify before starting |
| 2 | code.claude.com/docs/en/sub-agents — no first-class "restrict Write to path glob" primitive; tembo.io community guidance recommends prose-scoping given that gap | "Test files only" is stated as a prose convention the agent must self-police, not a tool-level lock — no `PreToolUse` hook enforces it in this repo | `test-writer.md`, "Prose-restated restriction — test files only" |
| 3 | Kent C. Dodds, "Testing Implementation Details" | Client tests assert on user-observable behavior (rendered text, roles, interaction outcomes), never internal state/props | `test-writer.md`, "Per-area routing — Client" |
| 4 | Martin Fowler, "Practical Test Pyramid" — sociable vs. solitary unit tests, one integration point per integration test, "testing private methods is a smell → refactor, don't mock harder" | Server-unit tests prefer sociable tests with real collaborators; mocking reserved for genuinely awkward externalities (LLM, GitHub, git), not the module's own repository/service layer | `test-writer.md`, "Per-area routing — Server unit" |
| 5 | `TESTING.md` "Conventions" (project doc) | Server-integration tests must be named `*.it.test.ts`, use `test/helpers/pg.ts`, and self-skip without Docker — a skip must not be reported as a pass | `test-writer.md`, "Per-area routing — Server integration" |
| 6 | arXiv 2511.21382 + blog.ploeh.dk (2026-01-26) — LLM-generated tests' dominant failure mode is tautological/confirmation-biased assertions | Expected values must come from the plan/spec/contract, never derived by running the current implementation and asserting whatever it emits | `test-writer.md`, "Anti-confirmation-bias rule" |
| 7 | Root `CLAUDE.md` — wire contracts are `snake_case` at the HTTP boundary, `camelCase` internally | Route/contract tests assert on the wire shape as it crosses HTTP, not the internal TS/Drizzle shape | `test-writer.md`, "Wire-contract convention" |
| 8 | 2026-08-11 workflow audit (this session) — sharpens row #1/#6: "code already exists" is not itself a reason to pick characterization mode | When a `spec-creator` output or Development Plan is available, always default to specification mode against its `AC-N`/steps, even if implementation finished first — otherwise post-hoc test-writing risks exactly the tautological-test failure mode row #6 already warns about | `test-writer.md:41-48` |

## Practices applied, with sources — `architecture-reviewer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | `researcher.md:14-18` and built-in `Explore`/`Plan` docs precedent ("Write and Edit are denied") | No `Write`/`Edit` in the tool allowlist at all (not just discouraged in prose) — agent cannot change code and must not route around that via `Bash` | `architecture-reviewer.md` frontmatter (`tools: Read, Grep, Glob, Bash`) + Role section |
| 2 | Martin Fowler, "fitness functions" — an architectural rule only has teeth as an automated, checkable rubric | Applies this repo's own `onion-architecture` skill and `server/CLAUDE.md`/`client/CLAUDE.md` module shapes as the rubric, rather than inventing new architecture opinions; untraceable findings are downgraded to "observation" | `architecture-reviewer.md`, "Rule source, not freelancing" |
| 3 | dependency-cruiser rules-reference — rules are only valid if checkable/falsifiable against the actual dependency graph, not inferred from file naming or intent | Same rule as above, extended to "don't infer from a file's name or docstring" | `architecture-reviewer.md`, "Rule source, not freelancing" |
| 4 | code.claude.com/docs/en/code-review — mandatory verification step before surfacing a finding; optional `REVIEW.md` to raise the evidence bar (not present in this repo); severity + file:line + "how it verified" reasoning as the report shape | Every finding needs a `file:line` citation and a "Verification" line; no `REVIEW.md` exists in this repo so none is assumed | `architecture-reviewer.md`, "Evidence rule" + "Report format" |
| 5 | `.claude/plans/agent-orchestration-token-efficiency.md` (this repo's own prior measurement, waste pattern #1) | Accepts a pre-computed diff artifact as ground truth for "what changed" instead of rediscovering it via a fresh `git diff`/`git status`; accepts `plan-verifier`'s "Observed, not checked" as a starting checklist, still independently verified | `architecture-reviewer.md:26-35` ("Input — reuse what's already known") |

## Practices applied, with sources — `plan-verifier`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | code.claude.com/docs/en/best-practices, "Add an adversarial review step" | Requires both the plan/requirements doc and what to check it against (a diff or working tree) before starting; asks rather than guesses scope if either is missing | `plan-verifier.md`, "Step 0 — require both inputs" |
| 2 | TICK (arXiv:2410.03608) and "Decomposed Criteria-Based Evaluation" (ACL 2025 EMNLP-industry) | Decomposes the plan into a numbered, instance-specific checklist before checking any code, instead of holistic/vague scoring | `plan-verifier.md`, "Decompose before judging" |
| 3 | Anthropic, "Building Effective Agents" — evaluator-optimizer pattern requires explicit, articulable evaluation criteria; vague criteria is a named failure mode | Same decomposition rule; vague requirements route to "Could not verify" rather than a vague pass | `plan-verifier.md`, "Decompose before judging" + "Report format" |
| 4 | Gherkin/BDD practice — acceptance-criteria verification is institutionally kept separate from code-quality review | Explicitly does not comment on style/performance/security/architecture in the pass/fail checklist; those go to "Observed, not checked" | `plan-verifier.md`, "Hard boundary — not a code reviewer" |
| 5 | `.claude/plans/agent-orchestration-token-efficiency.md` (waste pattern #1) | A supplied diff artifact is ground truth for "what changed"; only file-content verification of specific claims still happens fresh | `plan-verifier.md:29-34` |

## Practices applied, with sources — `doc-writer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | dev.to doc-map pattern — agents should read an existing index before writing new docs, and update the index when adding a file | Step 0 reads `docs/agent-prompts/README.md`, `docs/APP_OVERVIEW.md`, `.claude/agents/README.md`, and the relevant module `README.md` before deciding where content goes; never invents a new top-level doc file if an existing index has a slot | `doc-writer.md`, "Step 0 — read the doc-map first" |
| 2 | sourcegraph.com/blog/documentation-as-code — "false freshness": an agent confidently writing docs from its own inference rather than verified code/tests | Every factual claim about code behavior is checked via `Read`/`Grep` against actual code/tests, not inferred from the plan text; discrepancies are documented as the code's real behavior, flagged against the plan's claim | `doc-writer.md`, "Verify, don't infer" |
| 3 | Diátaxis (diataxis.fr) — tutorial/how-to/reference/explanation classification | Classifies content by type before deciding its shape | `doc-writer.md`, "Classify before placing" |
| 4 | Google documentation style guide — placement hierarchy and "small set of fresh docs beats a large stale assembly"; "update docs in the same change as the code they describe" | Uses the placement hierarchy (inline comment → module README → docs/ guide → design doc), prefers updating an existing doc over creating a new one, avoids restating what the code already makes obvious | `doc-writer.md`, "Classify before placing" |
| 5 | mermaid.js.org — diagrams as version-controlled plain text | Invokes the `mermaid-diagram` skill for architecture/flow/sequence diagrams, sourced from the actual plan/feature structure | `doc-writer.md`, "Diagrams" |
| 6 | code.claude.com/docs/en/sub-agents — no first-class "restrict Write to path glob" primitive | "Documentation files only" is a prose convention, not a tool-level lock — no `PreToolUse` hook enforces it in this repo | `doc-writer.md`, "Prose-restated restriction — documentation files only" |
| 7 | `.claude/plans/agent-orchestration-token-efficiency.md` (waste pattern #2) | Narrow trust-mode carve-out: findings already carrying `file:line` citations from a read-only reviewer earlier in the same task are spot-checked (2–3), not fully re-derived; anything uncited still goes through the full verify-don't-infer pass | `doc-writer.md:75-79` |
