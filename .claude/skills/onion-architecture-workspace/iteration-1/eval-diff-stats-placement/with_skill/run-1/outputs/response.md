# Where the diff-stats recompute goes

Short answer: **neither file, as a monolithic block** — split it. The parse
itself is a pure function; only the "load the blob, run the parse, persist
the result" plumbing is orchestration, and that's `service.ts`. Raw reads/
writes are `repository.ts`. Nothing about it belongs in `reviewer-core`.

## What's actually there right now

Worth flagging before the placement question: `server/src/modules/pulls/`
currently has **no `service.ts` or `repository.ts`** — just `routes.ts`,
`status.ts`, `findings-summary.ts`. `routes.ts` talks to `container.db`
directly (see `GET /pulls/:id`, `server/src/modules/pulls/routes.ts:203-295`),
and diff stats (`additions`/`deletions`/`filesCount` on `pull_requests`) are
already being written there today — but from the GitHub API response
(`detail.additions` etc.), not from a locally-stored diff blob.

That's a pre-existing gap against the documented module shape
(`server/CLAUDE.md`: "`modules/<name>/` = `routes.ts` + `service.ts` +
`repository.ts`"), and it's exactly the kind of thing this task should not
grow further inside `routes.ts`. Since you're adding new orchestration logic
here, this is a reasonable point to actually introduce `service.ts` (and a
`repository.ts` for the `pull_requests`/`pr_files` queries currently inlined
in the route) rather than bolting one more concern onto the route handler.

## The split for this specific feature

1. **The parse (files changed / additions / deletions from a diff blob) is
   pure computation — no DB, no fs, no network.** Don't put it in
   `repository.ts` (that's for Drizzle access) and don't inline it in
   `service.ts` either; give it its own function, e.g.
   `modules/pulls/diff-stats.ts`, following the pattern already used for
   `findings-summary.ts` in this same module (`buildFindingsSummary`, a pure
   reducer called from the route/service). You very likely don't even need to
   write new parsing logic: `server/src/adapters/git/diff-parser.ts` already
   parses a unified diff into per-file `additions`/`deletions` (and the file
   list itself gives you "files changed" as `files.length`) — it's already a
   pure function taking a raw diff string and returning `UnifiedDiff`. Reuse
   it or wrap it with a small `summarizeDiffStats(diff: UnifiedDiff)` helper
   rather than re-deriving the same counts a second way.

2. **Loading the stored blob and writing the recomputed numbers back is
   `repository.ts` work.** Fetch the diff blob (wherever it's persisted —
   check `prFiles.patch` / whatever column backs "stored diff blob" for this
   PR) and the `update(pullRequests).set({ additions, deletions, filesCount })`
   call both belong in `repository.ts`, mirroring how `reviews/repository.ts`
   is split into `repository/pull.repo.ts` etc. for this same table.

3. **`service.ts` is the glue**: on "PR detail page reopened" (i.e. the
   `GET /pulls/:id` handler), the service method calls repository → gets the
   blob, calls the pure `diff-stats.ts` helper → gets counts, calls
   repository → persists them, and returns the updated detail to the route.
   The route stays a thin HTTP translator that calls one service method.

## Does `reviewer-core` need to know about this?

No. `reviewer-core` consumes a diff to build LLM prompts and to ground
findings' `file:line` citations against real hunks (see
`reviewer-core/README.md`'s pipeline diagram and `groundFindings()` in
`reviewer-core/src/grounding.ts`) — it's about review correctness, not about
displaying PR size on the detail page. Diff-stat display (files/±) is a
server-only, UI-facing concern that has nothing to do with the
diff→prompt→LLM→grounded-findings contract reviewer-core exists to protect.
Keep it entirely inside `server/src/modules/pulls/`; there's no reason for
`reviewer-core/src/**` to gain a new dependency or export for this.

One flag either way: if it turns out `reviewer-core` *also* independently
re-parses the diff for its own stats somewhere, that would be a sign the
parsing logic should move to a shared, dependency-free location both sides
import (candidate: promote `diff-parser.ts`'s logic to
`server/src/vendor/shared` if `reviewer-core` needs the same shape) — but
nothing in `reviewer-core/src/**` currently computes files-changed/±
counts, so that doesn't apply here.
