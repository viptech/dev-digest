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
| 2026-08-13 | [fea391f8](sessions/fea391f8.md) | 25 (d1) | 64.9M | 529.9M | 98.3% | 2162 | 13h18m active span, 07:21–20:39 (main's own transcript spans to 08-15 but sat idle ~86h across 16 gaps — excluded, see `active_duration_s`) | Preload `client/src/vendor/ui/nav.ts` — 3 agents cold-read it 11x combined; same pattern on `.claude/plans/spec-04-pr-why-risk-brief.md` (10x) and `spec-03-onboarding-generator.md` (9x) across planner→reviewer→verifier stages |
| 2026-08-22 | [2144b1fd](sessions/2144b1fd.md) | 19 (d1) | 42.1M | 341.0M | 98.4% | 1786 | 11h18m span (20:25→07:44 UTC; `main` active 2h43m of that, rest is overnight/session-limit-outage idle across 5 gaps) | Two dispatches (`implementer` SPEC-08 Group 4, `plan-verifier` SPEC-07) hit the account session limit mid-run and needed a manual `/login` to resume — both were the largest task of their kind (22-file wizard; exhaustive 31-AC/16-task read-only verification); split similarly large groups further or checkpoint progress before dispatching next time |
