---
name: sdd-implement
description: Executes an already-approved Development Plan through the full multi-agent verification chain — implementer, then a plan-verifier/architecture-reviewer loop that automatically feeds findings back to implementer for up to 3 rounds, then an opt-in doc-writer. Does NOT write specs or plans — spec-creator and implementation-planner are run separately, by hand, before this skill. Use once a plan exists at .claude/plans/<slug>.md and you want the review/fix cycle automated instead of dispatched by hand.
---

# SDD Implement

## Overview

Runs the execution tail of this repo's Spec Driven Development chain on an
**already-approved** Development Plan: `implementer` → a `plan-verifier` /
`architecture-reviewer` loop that automatically sends findings back to
`implementer` for a fix pass (up to 3 rounds total) → an optional
`doc-writer` pass. See `.claude/agents/README.md`'s "Хендоф" section for
the full agent-chain rationale this skill automates.

**Not included, by design**: `spec-creator` and `implementation-planner`.
Both are run manually, separately, before this skill — spec review and
plan review are decisions the user makes interactively, not something to
loop through automatically. If there's no plan yet, this skill stops and
says so; it never writes one on your behalf.

**`test-writer` is skipped by default** (cost — Opus/Sonnet spend adds up
across a loop; this was an explicit choice, not an oversight). Ask for
`and write tests` in your invocation to include it later once that's
wanted again.

## Cost note — read before wondering "why is this expensive"

Every agent this skill dispatches (`implementer`, `plan-verifier`,
`architecture-reviewer`) already declares `model: sonnet` in its own
frontmatter. This skill's instructions must **never** pass a `model`
override on any `Agent`-tool call for these agents — an explicit override
at the call site is what would push a dispatch onto a more expensive model
despite the frontmatter default, not anything about the agents themselves.

## When to use

- A Development Plan already exists at `.claude/plans/<slug>.md` with
  `**Execution mode:** multi-agent`.
- You want the verify → fix → re-verify cycle to run without manually
  re-dispatching `plan-verifier`/`architecture-reviewer`/`implementer`
  yourself after every finding.
- **Not** when no plan exists yet — run `implementation-planner` first.
- **Not** when the plan says `single-agent` — that mode already folds
  self-verification into `implementer`'s own steps; ask before running
  this skill's review loop on top of it (see Step 0).

## Step 0 — parse input and preflight

From the free text passed to this skill, extract:

- **Required**: a path to a Development Plan (`.claude/plans/<slug>.md`).
  If none is found, stop: tell the user to run `implementation-planner`
  first and re-invoke this skill with its output path. Do not guess a
  path or write a plan yourself.
- **Optional**: a path to a `spec-creator` output
  (`docs/specs/<module>/SPEC-NN-*.md`) — pass it to `plan-verifier` in
  Step 2 alongside the plan so its checklist also covers the spec's
  `AC-N` items, not just the plan's steps.
- **Optional**: free-form notes to relay to `implementer` verbatim.
- **Optional**: an explicit request to update docs (e.g. "and update
  docs") — this is the only thing that turns on Step 3; default is off.
- **Optional**: an explicit request to include tests (e.g. "and write
  tests") — turns `test-writer` back on, run alongside
  `architecture-reviewer` each loop round; default is off.

Read the plan file. Check `**Execution mode:**`:
- `multi-agent` → proceed.
- `single-agent` → warn that this skill's review loop assumes a separate
  `implementer`, and ask whether to proceed anyway (duplicate work risk)
  or stop.

If a spec path was given, confirm the file exists before continuing.

## Step 1 — run `implementer`

Dispatch `implementer` (Agent tool, `subagent_type: implementer`, **no**
`model` parameter) with: the plan path, the spec path if given, and any
relayed notes. Wait for its full report before continuing.

## Step 2 — verify/review loop (shared cap: 3 rounds total)

One round counter shared across **both** triggers below — not 3 rounds
per reviewer, 3 total, so the cap stays a meaningful bound.

```
round = 1
loop:
    1. Compute the diff once this round (e.g. `git diff` into a scratch
       file under this session's scratchpad directory). Reuse this same
       artifact for both dispatches below instead of letting each
       reviewer re-derive it — this is the existing diff-artifact
       convention (.claude/agents/README.md, "Хендоф").

    2. Dispatch plan-verifier (no model override) with: the plan path,
       the spec path (if given), and the diff artifact — tell it
       explicitly to treat the diff as ground truth for "what changed"
       per its own Step 0 convention.

       If it reports FAIL or PARTIAL on any required item:
         - round == 3 → go to Escalate, stop.
         - Otherwise: dispatch implementer again with the specific
           failing items as a targeted fix list (not the whole plan
           re-run). round += 1. Go back to step 1 of this loop (re-diff).

    3. Dispatch architecture-reviewer (no model override) with: the same
       diff artifact, plus plan-verifier's "Observed, not checked"
       section as a starting checklist (it still verifies each item
       itself — this just saves it a rediscovery pass).

       (If tests were opted in: dispatch test-writer in parallel with
       architecture-reviewer this round, same diff artifact.)

       If it reports any critical or major finding:
         - round == 3 → go to Escalate, stop.
         - Otherwise: dispatch implementer again with the specific
           findings as a targeted fix list. round += 1. Go back to step 1
           (both reviewers re-run after any fix — a fix for one can
           regress the other).

    4. Neither triggered a fix → break, proceed to Step 3.
```

Minor architecture-reviewer findings never trigger the loop — carry them
into the final report as non-blocking observations (same severity
philosophy as the `pr-self-review` skill, where only Critical blocks).

**Escalate**: stop immediately, report exactly what's still
failing/found (the verbatim checklist and/or findings), and let the user
decide — fix by hand, accept the residual issue, or re-invoke with more
context. Never silently accept a failing state as "close enough."

## Step 3 — `doc-writer` (opt-in only, default skipped)

Only run this if the user's original input explicitly asked for docs.
Before spawning the agent, check the orchestrator skip-rule
(`.claude/agents/README.md`, "Коли `doc-writer` не потрібен"): if
everything it would need is already verified and present in this
session's own context from the loop above, update the doc directly
instead of spawning it.

## Report format

```markdown
## Summary
- Plan: <path> (+ spec: <path>, if given)
- Rounds used: N / 3
- implementer: files changed, skills applied, tests run
- plan-verifier: final checklist (PASS/FAIL/PARTIAL per item)
- architecture-reviewer: final findings this run (or none) + any residual
  minor observations
- test-writer: skipped this run (default), or ran because it was opted in
- doc-writer: ran / skipped, and why
- Escalated to user: [none, or what's still outstanding]
```

## Common mistakes

- Passing a `model` override "to be safe" — don't; it's the one thing
  that would actually make this more expensive than the agents' own
  frontmatter defaults.
- Trying to invoke `implementation-planner` yourself when no plan path is
  found — that's explicitly out of scope; stop and ask instead.
- Running `plan-verifier`/`architecture-reviewer` without the diff
  artifact from this same round — that's the redundant-rediscovery cost
  this skill exists to avoid.
- Treating a round-3 escalation as a soft warning — it's a stop, not a
  "proceeding anyway" note.
