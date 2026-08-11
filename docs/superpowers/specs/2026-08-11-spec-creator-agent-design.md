# Design: `spec-creator` subagent — Spec Driven Development

Status: approved (agreed in-session with the user, 2026-08-11)

## Context

DevDigest has no formal spec artifact today. The closest prior art is an
informal `docs/superpowers/specs/*-design.md` → `docs/superpowers/plans/*.md`
pipeline (freeform Markdown, no template, no acceptance criteria, no
traceability). The user wants Spec Driven Development: a dedicated subagent,
`spec-creator`, that turns a task into a structured spec **before** any
`implementation-planner`/`implementer` work starts, using EARS-style
acceptance criteria and explicit traceability.

Two existing subagents already *consume* "plan/spec" as an input without
producing one (`test-writer.md`, `plan-verifier.md` — confirmed by repo
search, no conflict). `spec-creator` is the missing producer at the front of
that chain. Wiring the rest of the pipeline to read `spec-creator`'s output
is explicitly deferred (see "Out of scope").

## Two spec types, one agent

### Architectural spec — long-lived, product/module frame

Describes module boundaries, contracts, data flow, stack, invariants. Not
about one feature; only touched when a feature changes the actual
architecture, not merely operates within it.

- **Location**: one per module — `docs/specs/<module>/architecture.md`
  (`server`, `client`, `reviewer-core`, `e2e`) — plus one cross-cutting
  `docs/specs/architecture.md` for product-wide concerns that don't belong to
  a single module.
- **Versioning**: a single canonical file per scope, edited in place. No
  `ARCH-NN` numbering — git history is the record of how it changed over
  time (consistent with how the repo already treats `docs/APP_OVERVIEW.md`).
- **Template**:

```markdown
# Architecture Spec: <module or product>
Status: draft | approved
Last reviewed: YYYY-MM-DD
Supersedes: <link, if replacing a prior decision>

## Overview
Short description of what this module/product is and its role in the system.

## Module boundaries
What is in/out of scope for this module, who owns what.

## Contracts
Interfaces / wire formats this module exposes or consumes.

## Data flow
How data moves between components/modules.

## Stack
Technologies/libraries pinned to this module.

## Invariants
What must always remain true regardless of any single feature.
```

### Feature spec — one behavior change

- **Location**: `docs/specs/<module>/SPEC-NN-<slug>.md`. `NN` is sequential
  **within that module's folder** — glob existing `SPEC-*.md` there, take
  max + 1, or `01` if none exist.
- **Template** (given by the user, unchanged):

```markdown
# Spec: <назва фічі>
Spec ID: SPEC-NN
Status: draft | approved | implemented
Supersedes: <посилання, якщо нова спека замінює попереднє рішення>

## Проблема й користувач
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance
## Untrusted inputs
## Open questions
```

Followed by a task checklist mapping each task to the AC it satisfies and the
test that will confirm it:

```markdown
- [ ] T1 <task>  → AC-N → <test_name>
```

- A feature spec that touches module boundaries, contracts, or data flow
  must cite the relevant section of that module's `architecture.md`. If the
  feature actually *changes* the architecture (not just operates within it),
  `spec-creator` raises this explicitly as a recommendation to the user
  instead of silently editing `architecture.md` itself or silently ignoring
  the mismatch.

### Naming collision avoided

`e2e/specs/` (test-flow JSON) and `docs/superpowers/specs/` (freeform
brainstorming design docs) already use "specs" for unrelated things.
`docs/specs/<module>/` is a new, dedicated tree — `spec-creator` never
reads from or writes to either of the other two.

## EARS reference (inlined into the agent prompt)

Five patterns, each requirement stated with "shall":

- **Ubiquitous** — always true: "The system shall log every authentication
  attempt."
- **Event-driven** — "WHEN `<trigger>`, the system shall `<response>`."
- **State-driven** — "WHILE `<state>`, the system shall `<behavior>`."
- **Unwanted behavior** — "IF `<unwanted condition>`, THEN the system shall
  `<response>`."
- **Optional feature** — "WHERE `<feature is enabled>`, the system shall
  `<behavior>`."

Every `AC-N` in a feature spec must match one of these five shapes.

## Six clarification categories (inlined, run during Step 2)

Data & loading · Display & sorting · Interactions · State & persistence ·
Feedback · Edge cases (empty states, large volumes, concurrency, partial
data) — see body of the agent file for the full checklist per category.

## Tools and write restriction

```
tools: Read, Grep, Glob, Write, Edit, Bash, WebSearch, Skill
disallowedTools: Bash(git commit:*), Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)
```

Same shape as `doc-writer.md`/`test-writer.md`: full Write/Edit access at the
tool level, restricted by **prose convention** (no `PreToolUse` path-glob
hook exists in this repo — confirmed precedent). `spec-creator` writes only
`*.md` files under `docs/specs/**`; it never edits source code or any doc
outside that tree (not even `docs/APP_OVERVIEW.md`, which it may read for
context but never writes to).

## Design-source ingestion

The user supplies whatever exists: a text description, a Figma
export/description (treated as pasted text or an image `spec-creator` reads
via the `Read` tool — no live Figma API integration exists or is being
built), existing code, or "go look at the repo." If nothing is supplied,
`spec-creator` asks once (Step 0) and, absent an answer, falls back to the
current implementation (via `Read`/`Grep`) as the baseline to spec against.

## Dialogue model — block once, then inline

- **Step 0 (blocking)** — before reading anything: spec type
  (architecture/feature), target module(s), any design source available now,
  whether this supersedes an existing spec. These must be answered before
  proceeding.
- **Step 1 (research)** — reads root `CLAUDE.md`, the **module-scoped**
  `INSIGHTS.md` only (root + the specific module(s) in play — never a blanket
  read of every module's `INSIGHTS.md`), the module's `README.md`/`CLAUDE.md`,
  any existing files under `docs/specs/<module>/`, and the supplied design
  source / current code. If something needs deeper investigation beyond
  `Read`/`Grep`/`WebSearch` — e.g. researching how an external library
  behaves, or non-trivial cross-module behavior — `spec-creator` does **not**
  guess: it lists each investigation as an independent question under a
  `## Research needed` heading in its response and stops. The orchestrating
  session dispatches one or more `researcher` subagents in parallel (one per
  independent question) and relays findings back so `spec-creator` can
  resume. (`spec-creator` itself has no `Task`/`Agent` tool — this mirrors
  the existing "ask, orchestrator relays" pattern already used by
  `implementation-planner`'s clarifying questions; no subagent in this repo
  dispatches further subagents today.)
- **Step 2 (analysis, non-blocking)** — runs the six clarification
  categories plus: gaps against the supplied design, uncovered corner cases,
  cross-module communication, and UX improvement opportunities. Anything
  still unresolved here is written inline as
  `[NEEDS CLARIFICATION: ...]` in the draft's `Open questions` section —
  it does not pause and ask again.
- **Step 3 (draft)** — writes the spec using the applicable template.
- **Step 4 (self-check, before returning the draft)**:
  - No placeholders/TBD left unresolved without being an explicit
    `[NEEDS CLARIFICATION]`.
  - Every `AC-N` matches one of the five EARS shapes.
  - **Traceability**: every `AC-N` traces to a Goal or User story; every Edge
    case maps to an `AC-N` or is explicitly an open question; every task in
    the checklist cites an `AC-N` and a test name; no `AC-N` is left without
    a task.
  - NFR section isn't empty for a non-trivial feature; if the feature
    touches untrusted content, it must reference this repo's `security`
    skill and the injection-guard/grounding-gate conventions from root
    `CLAUDE.md`.
  - `Open questions` preserves every unresolved item from Step 2 — none
    silently dropped.
- **Report** — the draft itself, plus a short summary: what was asked, what
  was found, what was flagged as a recommendation (including any suspected
  architecture-spec impact).

## Out of scope (this round)

- No changes to `implementation-planner.md`, `test-writer.md`, or
  `plan-verifier.md` — `spec-creator` is standalone. A future task can teach
  `implementation-planner` to read a `SPEC-NN` file as an input, and
  `test-writer`/`plan-verifier` to cite `AC-N` explicitly.
- No live Figma/browser integration.
- No root `CLAUDE.md` "Read when" table entry for `docs/specs/` yet (can be
  added once the convention has real content).

## Self-review of this design doc

- Placeholder scan: none found.
- Internal consistency: architecture-spec versioning (edit-in-place, no
  numbering) doesn't conflict with feature-spec versioning (`SPEC-NN`,
  append-only) — they're deliberately different because one is long-lived
  and canonical, the other is one-shot per behavior change.
- Scope check: single agent, two spec types it's responsible for; pipeline
  wiring correctly deferred rather than creeping into this design.
- Ambiguity check: "Figma as input" resolved to pasted text/image, not API
  access; "research" resolved to delegation via the existing
  ask-and-relay pattern, not a new nested-dispatch mechanism.
