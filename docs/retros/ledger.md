# Workflow retro ledger

One row per `/workflow-retro` run, newest at the bottom. Append only — the
value of this file is the trend, so past rows are never rewritten or reordered.

Numbers come from `deep` mode only
(`.claude/skills/workflow-retro/collect.sh`). In-context estimates are
deliberately excluded: a parent agent's summary under-reports its subagents by
4x–56x, so mixing the two would make the trend meaningless.

**Weighted** is billable-weighted spend in units of base input tokens (cache
write 1.25x, cache read 0.1x, output 5x) — the number to compare across runs.
**Raw** is the unweighted sum, kept only because it is what most tooling shows.

| Date | Session | Agents | Weighted | Raw | Cache | Tools | Wall | Top action |
|---|---|---|---|---|---|---|---|---|
| 2026-08-11 | fde0d443 | 5 (d1) | 6.86M | 46.7M | 97.6% | 248 | 19h span (not continuous — 4 separate tasks, not one pipeline run) | Confirm ambiguous target before dispatching Explore — 1 run discarded (~72k wasted) on a planner/implementer mix-up; same agent files re-read from scratch by later, unrelated tasks in the same session |
