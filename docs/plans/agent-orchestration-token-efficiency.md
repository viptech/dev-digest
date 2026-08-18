# Development Plan — Token Efficiency for Multi-Agent Review Chains

## Context

The Intent Layer session (this branch, 2026-08-03) measured ~408k subagent
tokens across `implementer` (229k) + `architecture-reviewer` (44k) +
`plan-verifier` (57k) + `doc-writer` (78k) for one medium feature. Root-cause
analysis (recorded in chat, not yet in a durable artifact) found five
distinct waste patterns, none of which trade away verification rigor — they
remove *redundant* work, not real checks:

1. `architecture-reviewer`, `plan-verifier`, and `doc-writer` each
   independently re-discovered the same diff via their own `git
   status`/`git diff`/`Glob`/`Grep` pass — three cold re-reads of the same
   files.
2. `doc-writer`'s "verify every claim" instruction made it re-verify
   findings that two prior read-only reviewers had already verified with
   `file:line` citations — a third independent verification pass over
   already-trustworthy evidence.
3. `implementer` reported having no Bash tool this session and substituted
   an expensive manual "file-by-file type-consistency review" for what
   `pnpm typecheck` would have answered in seconds — but `implementer.md`'s
   frontmatter *does* list `Bash` in `tools`. This is a discrepancy to
   reproduce, not an assumed config gap to patch blindly.
4. `architecture-reviewer`/`plan-verifier` mix mechanical evidence-gathering
   (grep, cite file:line) with judgment (is this PASS or PARTIAL, is a
   deviation justified) in one `model: sonnet` call — the mechanical half is
   a plausible candidate for a cheaper model, but swapping blindly risks
   the judgment quality that gives these agents their value; needs a
   measured trial, not an assumption.
5. The orchestrating session (this one) spawned `doc-writer` for a
   compile-and-write step even though every fact it needed was already
   verified and present in the orchestrator's own context — the same doc
   update was later done directly by the orchestrator, near-zero marginal
   token cost, proving the agent spawn wasn't required.

## Goal

Cut subagent token spend on multi-agent review/document chains without
dropping any check currently performed — same findings, same file:line
evidence, same final PASS/PARTIAL/MISSING verdicts.

## Modules involved

- `.claude/agents/architecture-reviewer.md`, `plan-verifier.md`,
  `doc-writer.md`, `implementer.md` — prompt/config edits only, no
  application code.
- `.claude/agents/README.md`, `docs/claude-code-agents.md` — index docs that
  must stay in sync with any agent-prompt change (existing repo convention:
  README.md is index-only, full rationale table lives in
  `docs/claude-code-agents.md`).
- No `server/`, `client/`, or `reviewer-core/` files are touched by this
  plan.

## Constraints

- Do not weaken any agent's evidence bar (`file:line` citation requirement,
  decompose-before-judging, read-only tool restrictions). Every change here
  is about *avoiding redundant* work, not skipping real verification.
- `architecture-reviewer` and `plan-verifier` must keep their hard boundary
  of not commenting on each other's territory (`plan-verifier.md`'s
  "Observed, not checked" section, `architecture-reviewer.md`'s "Not
  architecture" section) — the diff-artifact change must not blur that.
- Model-tier changes (item 4) are experimental and must be validated by a
  side-by-side comparison before being adopted as the default, not shipped
  on assumption — a token-cheaper reviewer that misses a real finding is a
  regression, not an optimization.
- `doc-writer`'s "verify, don't infer" principle stays the default for any
  claim *not* already backed by another agent's citation in the same
  session — the trust-mode carve-out is narrow, not a blanket "skip
  verification."

## Ordered steps

### 1. Reproduce the `implementer` Bash-availability discrepancy

Before changing anything, confirm whether `implementer` genuinely lacked
Bash this session (environment/permission issue) or mis-reported it
(prompting issue). Run a throwaway `implementer` invocation on a trivial
task that only requires running one shell command (e.g. "run `pnpm
typecheck` in server and report the output verbatim") and check whether it
completes via `Bash` or again claims no shell access.
- If reproducible: this is an environment/session config bug outside this
  plan's file-edit scope — escalate/report separately, and in the meantime
  add one sentence to `implementer.md`'s Step 2 ("test") telling it to state
  plainly "Bash unavailable this session" and stop rather than manually
  simulating a type-checker's output, which is the actual token-waster.
- If not reproducible: no config change needed here; note it as a one-off
  in this session's own `INSIGHTS.md` entry (root, since it affects agent
  orchestration, not one module) so future sessions know it was checked.

### 2. Diff/evidence artifact convention (waste patterns #1)

Add a short, explicit convention — **not to every agent's own file**, but to
the orchestration handoff description in `.claude/agents/README.md`'s
"Хендоф" section (and mirrored in `docs/claude-code-agents.md`'s rationale
table) — stating: when the orchestrating session runs more than one
read-only reviewer against the same diff in the same task, it must compute
the diff once (`git diff` to a scratch file, or an explicit file list) and
pass that artifact's path/content in every reviewer's prompt, instead of
instructing each one to "get the diff yourself." This is an orchestrator
*prompting* habit, so the durable place for it is the handoff doc other
sessions/people read, not a tool restriction — no agent's tool allowlist
changes.
- Also add one sentence to `architecture-reviewer.md`'s "Вхід" section and
  `plan-verifier.md`'s "Step 0" (which already half-says this — "give the
  subagent the diff and the plan") making explicit that a supplied diff
  artifact is to be treated as ground truth for *what changed*, not
  re-derived via a fresh `git diff`, while file-content verification
  (reading the actual current file to confirm a claim) still happens
  normally — this preserves the evidence bar while cutting the discovery
  tool-call overhead measured at 22–30 calls/agent this session.

### 3. `doc-writer` trust-mode carve-out (waste pattern #2)

Edit `doc-writer.md`'s "Verify, don't infer" section to add a narrow
exception: when the orchestrator's prompt supplies findings that already
carry `file:line` citations from a read-only reviewer agent run earlier in
the *same* task/session, treat those citations as verified ground truth by
default — spot-check a small sample (2–3) rather than re-deriving the full
set from scratch. The existing rule (verify claims against real code, don't
trust the plan text or a summary blindly) stays the default for anything
*without* such a citation, e.g. text from the orchestrator's own unverified
narrative. State the distinction plainly so it can't be read as "trust
everything you're told."

### 4. Model-tier trial for mechanical evidence-gathering (waste pattern #4)

Do not change `model: sonnet` in `architecture-reviewer.md`/
`plan-verifier.md` yet. Instead, run one controlled comparison: re-run
`architecture-reviewer` on a past, already-reviewed diff (e.g. this same
Intent Layer diff) with `model: haiku` passed as an Agent-tool call
override, and diff its findings against the sonnet run already on record in
this session. If the haiku run reproduces the same findings (same
file:line, same severity) at materially lower token cost, adopt `model:
haiku` as the default in the frontmatter for these two agents; if it misses
or misjudges anything, keep sonnet and drop this line item — do not average
the two into a "usually fine" compromise.

### 5. Orchestrator skip-rule for `doc-writer` on already-verified content
(waste pattern #5)

Add one sentence to `.claude/agents/README.md`'s "Хендоф" section: when the
content a doc needs is already fully verified and present in the
orchestrating session's own context (e.g. two reviewer agents just ran and
returned cited findings), the orchestrator should write/update the doc
directly rather than spawning `doc-writer`, reserving the agent for cases
where the doc requires exploring code/tests beyond what's already verified
in context. This is a habit for the orchestrating session (this Claude
instance across future sessions), most durably captured as a `feedback`
memory (per this session's auto-memory system) in addition to the README
note, since it governs *my* behavior across conversations, not just this
repo's documented convention for other readers.

## Test plan

This plan edits prompts/docs, not application code — no `pnpm
test`/`typecheck` applies. Verification is behavioral, done by re-running
the same review chain on a known diff and comparing:
- **Step 1**: confirms Bash availability is a real/fake problem — pass
  condition is a clear yes/no answer, not a code change.
- **Step 2**: re-run `architecture-reviewer` + `plan-verifier` on a diff
  with a pre-supplied diff artifact; pass condition is materially fewer
  tool_uses (target: under ~10 discovery calls each, down from 22–30) with
  identical findings to the baseline run already on record.
- **Step 3**: re-run `doc-writer` with pre-verified, cited findings
  supplied; pass condition is materially fewer tokens with the same doc
  content, and confirm it still catches an intentionally-injected false
  claim (one uncited claim planted in the prompt) — proves trust-mode
  didn't remove real verification for the uncited case.
- **Step 4**: side-by-side finding comparison, haiku vs. sonnet, on the same
  diff — pass condition is identical findings; anything less is a fail and
  the change is reverted, not tuned.
- **Step 5**: no code test — track over the next few sessions whether the
  orchestrator (me) actually follows the skip-rule when the situation
  recurs.

## Out of scope

- No change to `implementer`, `test-writer`, `planner`, or `researcher`
  beyond the one-sentence Bash-reporting clarification in Step 1 — their
  token profiles weren't implicated by this session's measurements.
- No change to the actual `onion-architecture` skill or any evidence
  standard — this plan is entirely about avoiding redundant re-derivation
  of already-available facts, never about lowering the bar for what counts
  as a verified finding.
- Prompt-cache-level optimizations (e.g., a persistent "context pack"
  shared across agent processes) are out of scope — Claude Code's Agent
  tool starts each subagent cold with no shared cache today; that's a
  platform capability, not something this repo's prompts can change.

## Implementation status (2026-08-11)

Implemented as part of a broader SDD-workflow audit, without the
controlled-comparison step this plan itself required for Step 1 and
Step 4:

- **Step 1** (Bash-availability discrepancy): not reproduced via a
  throwaway run as this plan specified. Applied the one-sentence
  mitigation directly instead — `implementer.md:81-86` now says plainly
  to report "Bash unavailable" and stop rather than hand-simulate a
  type-checker's output. If the original discrepancy resurfaces, it's
  still worth the actual reproduction run this plan describes.
- **Step 2** (diff/evidence artifact convention): done —
  `architecture-reviewer.md:26-35`, `plan-verifier.md:29-34`, and
  `.claude/agents/README.md`'s "Хендоф" section.
- **Step 3** (`doc-writer` trust-mode carve-out): done —
  `doc-writer.md:75-79`.
- **Step 4** (model-tier trial, haiku vs. sonnet for
  `architecture-reviewer`/`plan-verifier`): **still open** — this needs an
  actual side-by-side run on a real diff, not a prompt edit. Not done in
  this pass.
- **Step 5** (orchestrator skip-rule for `doc-writer`): the README note is
  in place (`.claude/agents/README.md`, "Хендоф"); whether the
  orchestrating session actually follows it is, as this plan already
  said, only provable by observing future sessions.
