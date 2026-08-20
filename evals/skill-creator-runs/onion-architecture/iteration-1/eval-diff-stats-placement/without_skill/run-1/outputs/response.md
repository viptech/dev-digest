# Where the diff-stats recompute should live

## Short answer

The actual *computation* (summing additions/deletions/files from the stored
diff blob) is business logic, not persistence — it belongs in a **service**,
not `repository.ts`. `reviewer-core` does not need to know about it at all.

## The wrinkle: `pulls` doesn't have a service.ts/repository.ts yet

`server/CLAUDE.md` documents the canonical module shape as
`routes.ts` (HTTP) + `service.ts` (orchestration) + `repository.ts` (data
access), and that's what `repos/`, `agents/`, `repo-intel/`, and `reviews/`
actually look like. `pulls/` is the odd one out — it currently has no
`service.ts` or `repository.ts` at all. `routes.ts` inline-queries Drizzle
directly, and there are two small pure-logic modules sitting next to it,
`status.ts` (`deriveReviewStatus`) and `findings-summary.ts`
(`buildFindingsSummary`), which `routes.ts` calls directly.

So there are two honest answers depending on scope:

**If you're just adding this one function and not refactoring the module:**
follow the pattern that's already there. Add a pure function — e.g.
`diff-stats.ts` exporting `computeDiffStats(files: { additions, deletions
}[]): { additions, deletions, files_count }` — with zero DB/Fastify imports,
unit-testable like `status.ts`/`findings-summary.ts` already are. Call it
from the `GET /pulls/:id` handler in `routes.ts` at the point where the
GitHub-refresh path currently falls through to "serve persisted" (see
`routes.ts:262-294`) — that's exactly the offline/stale-detail path recompute
would replace or backstop. The `container.db.update(t.pullRequests)` write
stays inline there too, same as the existing GH-backfill write on
`routes.ts:104-118`.

**If you're doing (or this nudges you toward) the service/repository split
the rest of the codebase already has:** then
- `repository.ts` gets a method to read the stored diff (the `prFiles` rows —
  `path/additions/deletions/patch` — there's no single "diff blob" column,
  it's per-file rows in `t.prFiles`) and a method to persist the recomputed
  `additions/deletions/filesCount` onto `t.pullRequests`.
- `service.ts` owns the *decision* — "GitHub refresh failed/unavailable, so
  fall back to recomputing from what's stored" — and calls the pure
  computation helper + the repository's read/write.
- The math itself (iterate files, sum) should still be a separate pure
  function the service calls, not inlined into either file — same reasoning
  as `status.ts`: it's trivial to unit test in isolation and has no business
  touching Drizzle.

Either way, **don't put the summing logic in `repository.ts`**. Keep
`repository.ts` (if/when it exists) to "get rows out, put rows in" — no
arithmetic, no branching on business rules like "only recompute if GitHub is
unavailable."

## Does `reviewer-core` need to know?

No. Confirmed by reading `reviewer-core/README.md` and grepping
`server/src/modules/reviews/diff-loader.ts` and `run-executor.ts` for
`additions`/`deletions`/`files_count` — zero hits. `reviewer-core`'s pipeline
is `diff → prompt → LLM → groundFindings`; it consumes the diff text itself
(fed by `diff-loader.ts` at review-run time), never the aggregate
additions/deletions/files-count numbers. Those numbers are display-only
metadata on the `PrMeta`/`PrDetail` wire contracts (`@devdigest/shared`),
used for the PR-list size badge and detail header — a pure `pulls`-module
concern. There's no grounding, scoring, or prompt-assembly dependency on
them, so this change is 100% server-side and reviewer-core is unaffected.
