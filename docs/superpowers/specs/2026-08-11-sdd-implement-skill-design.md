# Design: `sdd-implement` skill — automated execution tail of Spec Driven Development

Status: approved (agreed in-session with the user, 2026-08-11)

## Context

This session built the SDD agent chain: `spec-creator` (writes specs) →
`implementation-planner` (writes a Development Plan) → `implementer` →
`plan-verifier` → `architecture-reviewer` → (optionally) `doc-writer`, plus
a reordering (`plan-verifier` before `architecture-reviewer`) and a set of
token-efficiency conventions (shared diff artifact, trust-mode carve-outs).

Running that execution tail by hand means manually dispatching each agent,
manually computing/passing the diff artifact, and manually deciding whether
`architecture-reviewer`'s findings need another `implementer` pass. The user
wants a single skill that automates exactly this tail — **not** the
spec-writing or planning stages, which stay manual/interactive by explicit
choice (spec review and plan review are decisions the user wants to make
in the moment, not delegate to a loop).

## Scope

**In scope**: `implementer` → `plan-verifier` → `architecture-reviewer` →
fix-loop → optional `doc-writer`.

**Out of scope, explicitly**: `spec-creator` and `implementation-planner`
are never invoked by this skill — the user runs them separately, by hand.
If no plan exists yet, the skill stops and says so; it does not try to
produce one. `test-writer` is skipped by default this round (cost
reduction the user asked for explicitly) — mentioned in the report, not
silently dropped, and easy to turn back on later (see "Future flag").

## Naming

`sdd-implement` — matches the existing family naming
(`spec-creator` writes the spec, `implementation-planner` writes the plan,
`sdd-implement` executes the plan through verification). Deliberately not
`sdd-workflow`, which would overstate scope by implying it also covers
spec-writing and planning.

## Cost correction (factual, not a design choice)

`architecture-reviewer.md` and `plan-verifier.md` already declare
`model: sonnet` in frontmatter — they are not on Opus today. If prior runs
were expensive, the likely cause is an explicit `model` override passed at
the `Agent`-tool call site (the tool's `model` parameter overrides the
agent definition's own frontmatter), not the agent's own default. This
skill's instructions must never pass a `model` override for any agent it
dispatches — let each one use its own frontmatter default.

## Input

Free-text argument to `/sdd-implement <text>`. The skill's own Step 0
extracts, from that text:

- **Required**: a path to an approved Development Plan
  (`.claude/plans/<slug>.md`).
- **Optional**: a path to a `spec-creator` output
  (`docs/specs/<module>/SPEC-NN-*.md`) — if present, it's passed to
  `plan-verifier` alongside the plan so its checklist can also decompose
  the spec's `AC-N` items, not just the plan's own steps.
- **Optional**: free-form notes/constraints to relay to `implementer`
  verbatim (e.g. "skip the migration step, it's already applied").
- **Optional**: `and update docs` (or similar) — the explicit opt-in for
  running `doc-writer` at the end (default: skipped, per the user's cost
  concern).

If no plan path can be found in the text, stop and say: run
`implementation-planner` first, then re-invoke `sdd-implement` with its
output path. Do not attempt to plan on the user's behalf.

## Preflight

1. Read the plan file. Confirm `**Execution mode:**` says `multi-agent` —
   if it says `single-agent`, warn that this skill assumes the multi-agent
   chain and ask whether to proceed anyway or stop (a single-agent plan's
   "Ordered steps" already folds in self-verification, so running the
   multi-agent review chain on top of it may duplicate work rather than
   add value).
2. If a spec path was given, confirm it exists.

## Step 1 — `implementer`

Dispatch `implementer` (no `model` override) with the plan path, the
optional spec path, and any relayed notes. Wait for its report.

## Step 2 — verify/review loop (cap: 3 rounds total)

One shared round counter, incremented on *either* trigger below — not
3 rounds per reviewer, 3 rounds total, to keep the cap meaningful as a
token/time bound.

```
round = 1
loop:
    compute the diff once (git diff to a scratch file under this session's
    scratchpad directory) — reused by both reviewers this round, per the
    existing diff-artifact convention (.claude/agents/README.md, "Хендоф")

    dispatch plan-verifier (no model override) with: plan path, spec path
    (if given), the diff artifact as ground truth for "what changed"

    if plan-verifier reports FAIL/PARTIAL on a required item:
        if round == 3: escalate (see below), stop
        feed the failing items back to implementer as a targeted fix list
        round += 1
        continue loop  # re-diff, re-verify from the top

    dispatch architecture-reviewer (no model override) with: the same diff
    artifact, plus plan-verifier's "Observed, not checked" section as a
    starting checklist (still independently verified by architecture-reviewer
    itself, per its own "Input — reuse what's already known" section)

    if architecture-reviewer reports any critical or major finding:
        if round == 3: escalate (see below), stop
        feed those findings back to implementer as a targeted fix list
        round += 1
        continue loop  # both reviewers re-run after any fix, since a fix
                        # for one can regress the other

    break  # clean pass — proceed to Step 3
```

Minor architecture findings don't trigger the loop — they're carried into
the final report as non-blocking observations, same as `pr-self-review`'s
own severity gating (only Critical blocks there).

**Escalation** (round 3 exhausted with unresolved findings): stop, report
exactly what's still failing/found (plan-verifier's checklist and/or
architecture-reviewer's findings, verbatim), and let the user decide
whether to fix by hand, accept the residual issue, or re-run with more
context.

## Step 3 — `doc-writer` (opt-in only)

Only if the user's input explicitly asked for docs. Before spawning it,
apply the existing orchestrator skip-rule
(`.claude/agents/README.md`, "Коли `doc-writer` не потрібен") — if
everything `doc-writer` would need is already verified and present from
the loop above, update the doc directly instead of spawning the agent.

## Final report

```markdown
## Summary
- Plan: <path> (+ spec: <path>, if given)
- Rounds used: N / 3
- implementer: files changed, skills applied, tests run
- plan-verifier: final checklist (PASS/FAIL/PARTIAL per item)
- architecture-reviewer: final findings (resolved this run, or none) +
  any residual minor observations
- test-writer: skipped this run (cost-saving default — pass `and write
  tests` to include it)
- doc-writer: ran / skipped (and why)
- Escalated to user: [none, or what's still outstanding]
```

## Future flag (not built now, noted for later)

A `and write tests` opt-in to re-include `test-writer` in the loop
(running alongside `architecture-reviewer` each round, as originally
designed in `.claude/agents/README.md`'s "Хендоф") — deferred because the
user wants it off by default right now, not because it's hard to add.

## Self-review

- Placeholder scan: none.
- Internal consistency: the shared round counter (not per-reviewer) avoids
  a hidden 3×3=9-round worst case; escalation path is defined for both
  trigger conditions.
- Scope check: single skill, one clearly bounded phase (plan → verified
  code), doesn't creep into spec-writing or planning.
- Ambiguity check: "no plan found" always stops rather than guessing;
  `model` overrides are explicitly forbidden at every dispatch, closing
  the cost-leak vector the user was worried about even though the
  frontmatter was already correct.
