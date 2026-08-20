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
- per-agent `duration_s` — wall-clock seconds from that agent's first to last
  transcript record, **including idle waiting** (session left open, next-day
  continuation). Don't report this as work time — it's `main` on a session
  spanning days that badly inflates this number.
- per-agent `active_duration_s` (**report this one in the Агенти table**) —
  sum of gaps between consecutive transcript events that are ≤ `idle_gap_s`
  (600s / 10 min by default, tune via `WORKFLOW_RETRO_IDLE_GAP_S` if a session
  has legitimately long tool calls). Gaps longer than that are dropped
  entirely, not clamped. `idle_s` / `idle_gaps` show how much was cut and how
  many breaks caused it — call these out in Примітки when `idle_s` is large
  relative to `active_duration_s` (typically true for `main` on a multi-day
  session, rarely true for a subagent that ran start-to-finish).
- per-agent `skills` / session-level `skills_used` — which `Skill` tool calls
  each agent made (name + count), and the same rolled up across every agent in
  the session (not just the top-N in `agents`). An agent that never called
  `Skill` has an empty list — report it as "—", not as a gap in the data.
- per-agent `model` — for subagents, the model set on dispatch (from the
  agent's meta, e.g. `claude-sonnet-5`); for `main`, the unique set of models
  seen across its own requests, comma-joined. A `<synthetic>` entry in that
  set is a compaction/summary request, not a second model doing real work —
  don't report it as a model switch.

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

For the qualitative half, look for these in the agent reports and transcripts
(not in the collector's JSON, which is quantitative-only):

- **What was hard / easy** — retries, self-corrections, and "could not
  determine" sections in an agent's own report are the evidence.
- **Clarifying round-trips** — how often an agent needed re-prompting or
  correction mid-task. High on one agent points at an underspecified dispatch
  brief, not a slow agent.
- **Rework** — fix-loop iterations, retries, or re-spawns of the same agent
  for the same task.
- **Delegation correctness / scope drift** — did the right agent type take
  each task, and did each agent stay inside the paths/scope it was given.
- **Failure taxonomy** — terminal API errors, tool denials, blocked-on-human
  moments; categorize them so recurring friction is visible across runs, not
  just this one.

If you do not have the reports for a dimension, say so plainly — do not infer
difficulty, rework, or scope drift from token counts alone.

## Step 3 — report to chat

**The report is written in Ukrainian** — headers, prose and table content
alike (only field names / file paths / skill ids stay as-is). Lead with the
actions, not the table. Structure:

```markdown
## Ретроспектива — <короткий id сесії>
**Обсяг**: уся сесія, N агентів (макс. глибина D), <час виконання>
**Вартість**: <weighted> зважених токенів (<raw> сирих, <cache %> кешованих читань)

### Дії
1. <конкретна зміна> — бо <сигнал, із числом>
2. ...

### Агенти
| Агент | Модель | Тривалість | Скіли | Токени (зважені / сирі) |
|---|---|---|---|---|
| implementer/ab12cd34 | claude-sonnet-5 | 4м12с | onion-architecture, zod | 1.2M / 3.4M |
| test-writer/9f01aa22 | claude-sonnet-5 | 1м50с | — | 210K / 640K |

Один рядок на агента (`agent` + `model` + `active_duration_s` (не
`duration_s` — той включає простій) + `skills` + `tokens.weighted` /
`tokens.total` із JSON колектора). Агент без жодного виклику `Skill` отримує
«—» у колонці «Скіли» — це не пропуск у даних. Якщо `agents_omitted.count` >
0, додай після таблиці один рядок: скільки агентів не влізло і скільки
зваженого вони важать разом. Якщо в агента (найчастіше `main`) `idle_s`
суттєвий відносно `active_duration_s`, згадай це в Примітках — скільки
простою відсічено і скільки було перерв (`idle_gaps`).

### Куди пішла вартість
<топ-3–5 агентів за weighted, по одному рядку, з поясненням чому>

### Примітки
<паралелізм, коефіцієнт недооцінки, усе, на що дані не відповідають>
```

Keep it short. Three well-evidenced actions beat ten speculative ones — the
per-agent table is the added detail, not a license to pad the narrative
sections.

## Step 4 — save the full report to file

The chat report from Step 3 does not persist — it scrolls out of history.
Write the **exact same markdown** (Actions, the Агенти table, Куди пішла
вартість, Примітки) to `docs/retros/sessions/<short session id>.md` (create
`docs/retros/sessions/` if missing). One file per session, named after the
same short id used in the ledger's Session column — this is what Step 5 links
to, so write this file before appending the ledger row.

## Step 5 — append to the ledger, linking the report

Append **one row** to `docs/retros/ledger.md` (create the file with the header
below if missing). Append only — never rewrite or reorder past rows; the point
is the trend. The Session cell is a link to the file from Step 4, not bare
text:

```markdown
| Date | Session | Agents | Weighted | Raw | Cache | Tools | Wall | Top action |
|---|---|---|---|---|---|---|---|---|
| 2026-08-11 | [0cc0c9d6](sessions/0cc0c9d6.md) | 90 (d2) | 49.9M | 103M | 94% | 1204 | 1h32m | Preload knowledge.ts — 12 agents read it separately |
```

One line, deep-mode numbers only, same as before — the ledger is still the
trend view, not the detail view. What changed: the per-agent breakdown from
Step 3 is no longer chat-only, so it survives past the current conversation
instead of disappearing once you write the one-line summary. If a row would
not be comparable to the ones above it, note why in the Top action cell rather
than padding the table with new columns.

## Common mistakes

- Running this automatically. See the top of this file.
- Writing in-context numbers into the ledger — they undercount by up to 56x.
- Ranking agents by `tokens.total` instead of `tokens.weighted`, which makes
  cache-heavy agents look expensive when they are not.
- Re-deriving statistics by hand with your own `jq` instead of reading the
  collector's output once — the retro then costs more than what it saves.
- Reporting every row of `duplicate_reads` as a problem. Two agents reading
  `CLAUDE.md` is fine; twelve agents reading the same contract file is not.
- Appending the ledger row without first writing the Step 4 report file — the
  Session cell then links to nothing, and the per-agent detail is gone the
  moment the chat scrolls away.
