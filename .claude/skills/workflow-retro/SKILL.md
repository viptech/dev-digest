---
name: workflow-retro
description: Manual-only retrospective of a finished multi-agent workflow run — collects tokens, cache reads, tool calls, duration and parallelism (including nested subagents, whose spend never rolls up into the parent summary), turns them into concrete process changes, and appends one trend row to docs/retros/ledger.md. Invoke ONLY when the user explicitly asks for a workflow retro or types /workflow-retro. Never invoke it proactively, never chain it after another workflow, and never run it just because a pipeline finished.
---

# Workflow Retro

## Manual trigger only — this is a hard rule

Do **not** invoke this skill on your own initiative. Not after `sdd-implement`
finishes, not because a run looked expensive, not as a "helpful" follow-up. It
runs when the user explicitly asks for it and at no other time. A retro that
fires by itself defeats its own purpose: it adds cost to the very run it is
supposed to be measuring.

## Overview

Answers, for one session: how many tokens went where, how many agents ran and
in what order, what they duplicated, what they thrashed on, and what should
change next time. The output is **analysis plus concrete proposals**, not a
dashboard.

Two modes:

| Mode | Source | Accuracy | When |
|---|---|---|---|
| `in-context` (default) | agent reports already in this conversation | **Approximate — undercounts badly, see below** | Quick read on a run you just watched |
| `deep` | `collect.sh` reads session JSONL from disk | Accurate | Anything you will act on or write to the ledger |

### Why `deep` exists, and why in-context numbers must be labelled

A parent agent's `toolUseResult.totalTokens` reports only the subagent's
**final API call**, not its cumulative spend. Measured on real sessions in this
repo: **4x to 56x undercount**. Depth-2 agents (a subagent that spawned its own
subagent) never appear in the parent's numbers at all.

So: in `in-context` mode you must state plainly that the figures are a floor,
not a total. Never write in-context numbers into the ledger.

## Step 1 — collect

Deep mode (default choice whenever the user wants real numbers):

```sh
.claude/skills/workflow-retro/collect.sh              # newest session
.claude/skills/workflow-retro/collect.sh <sessionId>  # a specific one
.claude/skills/workflow-retro/collect.sh --full ...   # no top-N truncation
```

Read-only, needs `jq`, emits one JSON object (~1–15 KB depending on session
size). Run it once and work from its output — do not re-derive the same
numbers with your own `jq` calls, and do not read raw transcripts unless the
JSON is genuinely missing something you need.

The scope is the **whole session**. If the user ran unrelated work in the same
session, say so rather than silently attributing it to the workflow.

Fields worth knowing:

- `tokens.weighted` — billable-weighted (cache write 1.25x, cache read 0.1x,
  output 5x, in units of base input tokens). **Rank agents by this**, not by
  `tokens.total`; a 40M-token session that is 95% cache read is far cheaper
  than the raw number suggests.
- `timeline` — launch order, one compact string per agent.
- `overlaps` — genuinely concurrent agents (ancestors excluded, since a parent
  is trivially "running" while its child runs). Empty means fully sequential.
- `duplicate_reads` — files read by more than one agent, repo-relative.
- `batch_histogram` — tool calls per assistant message; `batch: 1` dominating
  means almost no parallel tool use.
- `undercount_check` — parent-reported vs actual, kept as a standing check.

## Step 2 — interpret

Map signals to actions. Only report a finding when the data actually shows it —
a retro that invents problems is worse than no retro.

| Signal in the JSON | Action to propose |
|---|---|
| `duplicate_reads` with `n` ≥ 3 | Preload that file once and pass it in each agent's prompt, instead of N cold reads |
| `cache_read_pct` low (< ~50%) on a long run | Context is being rebuilt each turn — check prompt ordering and whether agents are handed stable prefixes |
| One agent's `weighted` ≫ the rest | Overloaded role — split it, or move mechanical work to a cheaper tier |
| Many `Grep`/`Glob`/`Bash ls` in an agent's `tools` | It was not told where to look — name the files in its prompt |
| `overlaps` empty across many independent agents | Concurrency unused — those could have been dispatched in one batch |
| `overlaps` large with contended files in `duplicate_reads` | Too much concurrency on shared state — reduce it |
| `batch_histogram` almost all `batch: 1` | Independent tool calls are being serialised — batch them |
| Same file in `duplicate_reads` **and** edited by several agents in `timeline` order | Rework / failed handoff — the earlier agent did not get what it needed |
| Expensive `model` on an agent whose `tools` are mostly mechanical | Drop that agent to a cheaper tier |
| `agents_omitted.count` large | Many small agents — check whether the fan-out was worth its per-agent overhead |

For the qualitative half (what was hard, what was easy, what got missed), use
the agent reports in context if you have them: retries, self-corrections, and
"could not determine" sections are the evidence. If you do not have them, say
so — do not infer difficulty from token counts alone.

## Step 3 — report to chat

Lead with the actions, not the table. Structure:

```markdown
## Retro — <session short id>
**Scope**: whole session, N agents (max depth D), <wall clock>
**Cost**: <weighted> weighted (<raw> raw, <cache %> cache read)

### Actions
1. <concrete change> — because <signal, with the number>
2. ...

### Where the cost went
<top 3-5 agents by weighted, one line each>

### Notes
<parallelism, undercount ratio, anything the data could not answer>
```

Keep it short. Three well-evidenced actions beat ten speculative ones.

## Step 4 — append to the ledger

Append **one row** to `docs/retros/ledger.md` (create the file with the header
below if missing). Append only — never rewrite or reorder past rows; the point
is the trend.

```markdown
| Date | Session | Agents | Weighted | Raw | Cache | Tools | Wall | Top action |
|---|---|---|---|---|---|---|---|---|
| 2026-08-11 | 0cc0c9d6 | 90 (d2) | 49.9M | 103M | 94% | 1204 | 1h32m | Preload knowledge.ts — 12 agents read it separately |
```

One line, deep-mode numbers only. The full analysis stays in chat; the ledger
exists to show movement between runs, so if a row would not be comparable to
the ones above it, note why in the Top action cell rather than padding the
table with new columns.

## Common mistakes

- Running this automatically. See the top of this file.
- Writing in-context numbers into the ledger — they undercount by up to 56x.
- Ranking agents by `tokens.total` instead of `tokens.weighted`, which makes
  cache-heavy agents look expensive when they are not.
- Re-deriving statistics by hand with your own `jq` instead of reading the
  collector's output once — the retro then costs more than what it saves.
- Reporting every row of `duplicate_reads` as a problem. Two agents reading
  `CLAUDE.md` is fine; twelve agents reading the same contract file is not.
