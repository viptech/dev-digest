# Claude Code subagents: `researcher`, `planner`, `implementer`, `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

> These are Claude Code subagents (`.claude/agents/*.md`), not the in-app
> reviewer agents seeded into Postgres by `server/src/db/seed.ts` and
> documented in [`docs/agent-prompts/`](./agent-prompts/README.md). The two
> systems share the word "agent" but are otherwise unrelated — this file is
> about the former only.

Definitions: [`.claude/agents/researcher.md`](../.claude/agents/researcher.md),
[`.claude/agents/planner.md`](../.claude/agents/planner.md),
[`.claude/agents/implementer.md`](../.claude/agents/implementer.md),
[`.claude/agents/test-writer.md`](../.claude/agents/test-writer.md),
[`.claude/agents/architecture-reviewer.md`](../.claude/agents/architecture-reviewer.md),
[`.claude/agents/plan-verifier.md`](../.claude/agents/plan-verifier.md),
[`.claude/agents/doc-writer.md`](../.claude/agents/doc-writer.md).

`planner` reads module boundaries, `INSIGHTS.md`, `CLAUDE.md` constraints,
and the `.claude/skills/` catalog to produce a structured Development Plan
at `.claude/plans/<slug>.md` — including which skills the implementer will
need, so the plan can't drift from implementation rules. `implementer`
executes that plan across frontend/backend, applies the named skills, runs
the tests from `TESTING.md`, and verifies only its own changes — architecture
and security review are out of scope, owned by separate agents.

The sections below extend this roster with four more narrow-scope agents:
`test-writer` (writes tests per area/skill), `architecture-reviewer`
(read-only, onion-architecture boundary checks), `plan-verifier` (pass/fail
checklist against a plan, not generic review), and `doc-writer` (turns a
plan/feature into documentation). Each gets its own citation table below
rather than being folded into the planner/implementer table above, so
unrelated agents' sources don't get diluted together.

## Practices applied, with sources — `planner` + `implementer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | Anthropic, [`code.claude.com/docs/en/sub-agents`](https://code.claude.com/docs/en/sub-agents) — frontmatter table: only `name`/`description` required, plus `tools` as an allowlist | Minimal correct frontmatter with an explicit `tools:` list instead of inheriting the full tool pool | `planner.md:2-12`, `implementer.md:2-12` |
| 2 | Anthropic, sub-agents docs, built-in **Plan** agent: "read-only agent... Write and Edit are denied" | Planner is read-only with one exception — the plan file | `planner.md:12` (`permissionMode: plan`), reinforced in prose at `planner.md:19-21, 100-105` |
| 3 | Anthropic, sub-agents docs, `disallowedTools` — a denylist applied on top of the allowed pool, evaluated first | Implementer gets full Read/Write/Edit/Bash but with mutating git commands explicitly blocked | `implementer.md:12` (`disallowedTools: Bash(git commit:*), Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)`), reinforced at `implementer.md:24-26` |
| 4 | Anthropic, skills docs, "Preload skills into subagents" vs. on-demand discovery via the `Skill` tool | Don't preload full skill bodies into the planner up front (expensive, unnecessary) — read catalog descriptions and open a specific skill via `Skill` only when it's load-bearing for a plan decision | `planner.md:48-51` |
| 5 | Anthropic, sub-agents docs, "Chain subagents" — one subagent finishes and returns results, the orchestrator passes context to the next | Plan → implementation handoff via a file artifact rather than session memory | `planner.md:56-60` (writes `.claude/plans/<slug>.md`) + `implementer.md:28-31` (Step 0 reads that file, asks for a path if none given) |
| 6 | lucumr.pocoo.org, ["What Actually Is Claude Code's Plan Mode?"](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/) — durable-artifact-as-interface-between-stages pattern (research → plan → implementation, each agent's context stays clean) | Fixed plan-file structure as the contract between agents (Context/Constraints/Skills/Steps/Test plan/Out of scope), not free-form text | `planner.md:62-98`, especially `planner.md:77-82` ("Skills the implementer will use" — the direct answer to "plan must not conflict with implementation rules") |
| 7 | LangChain, ["Plan-and-Execute Agents"](https://www.langchain.com/blog/plan-and-execute-agents) / [emergentmind.com, Planner-Executor Agentic Framework](https://www.emergentmind.com/topics/planner-executor-agentic-framework) — planner decides "what", executor decides "how"; role separation works best with distinct tool access + explicit handoff artifacts | Planner has no `Edit`/`Write` on source (read-only + one file); implementer has full code access but doesn't re-decide architecture — it executes an already-approved plan | `planner.md:11-12` (tools) vs. `implementer.md:11-12`; stated in prose at `implementer.md:17-22` |
| 8 | Same planner/executor literature — verification kept separate from implementation | Implementer checks only plan-conformance and test pass/fail; explicitly no architecture or security verdict | `implementer.md:70-83` |
| 9 | Project `CLAUDE.md` ("Session protocol": read `INSIGHTS.md` before touching a module, verify cited `file:line` still holds) | Both agents must read the relevant `INSIGHTS.md` and check citations for staleness | `planner.md:41-44`, `implementer.md:34-35` |
| 10 | Project `CLAUDE.md` ("After a task that taught you something non-obvious... invoke `engineering-insights`") | Implementer invokes `engineering-insights` at the end of a non-trivial session | `implementer.md:85-89` |
| 11 | Existing `.claude/agents/researcher.md` (in-repo precedent, not an external source) — `Role → Step 0 clarify → …` structure, restrictions stated in prose as well as in config so the model doesn't try to route around them via `Bash` | Both files mirror this structure and restate their tool restrictions in prose | `planner.md:15-21, 100-105`; `implementer.md:15-26` |

**Not confirmed by official documentation** — flagged by the `researcher`
subagent as "could not determine": there is no Anthropic-documented pattern
specifically named "planner/implementer with mutual skill awareness." The
`## Skills the implementer will use` plan section (`planner.md:77-82`) is a
design inference combining rows #4 and #6 above, not a direct citation.

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

## Practices applied, with sources — `architecture-reviewer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | `researcher.md:14-18` and built-in `Explore`/`Plan` docs precedent ("Write and Edit are denied") | No `Write`/`Edit` in the tool allowlist at all (not just discouraged in prose) — agent cannot change code and must not route around that via `Bash` | `architecture-reviewer.md` frontmatter (`tools: Read, Grep, Glob, Bash`) + Role section |
| 2 | Martin Fowler, "fitness functions" — an architectural rule only has teeth as an automated, checkable rubric | Applies this repo's own `onion-architecture` skill and `server/CLAUDE.md`/`client/CLAUDE.md` module shapes as the rubric, rather than inventing new architecture opinions; untraceable findings are downgraded to "observation" | `architecture-reviewer.md`, "Rule source, not freelancing" |
| 3 | dependency-cruiser rules-reference — rules are only valid if checkable/falsifiable against the actual dependency graph, not inferred from file naming or intent | Same rule as above, extended to "don't infer from a file's name or docstring" | `architecture-reviewer.md`, "Rule source, not freelancing" |
| 4 | code.claude.com/docs/en/code-review — mandatory verification step before surfacing a finding; optional `REVIEW.md` to raise the evidence bar (not present in this repo); severity + file:line + "how it verified" reasoning as the report shape | Every finding needs a `file:line` citation and a "Verification" line; no `REVIEW.md` exists in this repo so none is assumed | `architecture-reviewer.md`, "Evidence rule" + "Report format" |

## Practices applied, with sources — `plan-verifier`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | code.claude.com/docs/en/best-practices, "Add an adversarial review step" | Requires both the plan/requirements doc and what to check it against (a diff or working tree) before starting; asks rather than guesses scope if either is missing | `plan-verifier.md`, "Step 0 — require both inputs" |
| 2 | TICK (arXiv:2410.03608) and "Decomposed Criteria-Based Evaluation" (ACL 2025 EMNLP-industry) | Decomposes the plan into a numbered, instance-specific checklist before checking any code, instead of holistic/vague scoring | `plan-verifier.md`, "Decompose before judging" |
| 3 | Anthropic, "Building Effective Agents" — evaluator-optimizer pattern requires explicit, articulable evaluation criteria; vague criteria is a named failure mode | Same decomposition rule; vague requirements route to "Could not verify" rather than a vague pass | `plan-verifier.md`, "Decompose before judging" + "Report format" |
| 4 | Gherkin/BDD practice — acceptance-criteria verification is institutionally kept separate from code-quality review | Explicitly does not comment on style/performance/security/architecture in the pass/fail checklist; those go to "Observed, not checked" | `plan-verifier.md`, "Hard boundary — not a code reviewer" |

## Practices applied, with sources — `doc-writer`

| # | Source | Rule | Where implemented |
|---|---|---|---|
| 1 | dev.to doc-map pattern — agents should read an existing index before writing new docs, and update the index when adding a file | Step 0 reads `docs/agent-prompts/README.md`, `docs/APP_OVERVIEW.md`, `.claude/agents/README.md`, and the relevant module `README.md` before deciding where content goes; never invents a new top-level doc file if an existing index has a slot | `doc-writer.md`, "Step 0 — read the doc-map first" |
| 2 | sourcegraph.com/blog/documentation-as-code — "false freshness": an agent confidently writing docs from its own inference rather than verified code/tests | Every factual claim about code behavior is checked via `Read`/`Grep` against actual code/tests, not inferred from the plan text; discrepancies are documented as the code's real behavior, flagged against the plan's claim | `doc-writer.md`, "Verify, don't infer" |
| 3 | Diátaxis (diataxis.fr) — tutorial/how-to/reference/explanation classification | Classifies content by type before deciding its shape | `doc-writer.md`, "Classify before placing" |
| 4 | Google documentation style guide — placement hierarchy and "small set of fresh docs beats a large stale assembly"; "update docs in the same change as the code they describe" | Uses the placement hierarchy (inline comment → module README → docs/ guide → design doc), prefers updating an existing doc over creating a new one, avoids restating what the code already makes obvious | `doc-writer.md`, "Classify before placing" |
| 5 | mermaid.js.org — diagrams as version-controlled plain text | Invokes the `mermaid-diagram` skill for architecture/flow/sequence diagrams, sourced from the actual plan/feature structure | `doc-writer.md`, "Diagrams" |
| 6 | code.claude.com/docs/en/sub-agents — no first-class "restrict Write to path glob" primitive | "Documentation files only" is a prose convention, not a tool-level lock — no `PreToolUse` hook enforces it in this repo | `doc-writer.md`, "Prose-restated restriction — documentation files only" |
