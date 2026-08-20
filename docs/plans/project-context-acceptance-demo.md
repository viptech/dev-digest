# Manual acceptance demo — Project Context (SPEC-01, AC-19)

Companion to `.claude/plans/project-context.md`, step 12. This is a human
sanity check, not an automated test — `server/test/reviews-project-context.it.test.ts`
already proves the *mechanism* (the attached document's full text reaches
the prompt). This script proves the *end-to-end product behavior*: a real
LLM, given a real invariant document and a real violating PR, cites it.

## Prerequisites

- `./scripts/dev.sh` running (Postgres + API + web).
- A real LLM provider key configured (`~/.devdigest/secrets.json` or env) —
  the mocked-LLM integration tests don't exercise real model behavior.
- A connected repo with a `api/` and a `db/` directory (or substitute any
  two directories your repo actually has, adjusting the document text below
  to match).

## Steps

1. **Author the invariant document.** In the connected repo, add
   `specs/architecture-invariants.md`:

   ```markdown
   # Architecture invariants

   - The `api/` module must not import `db/` directly. All database access
     from `api/` goes through the `services/` layer.
   ```

   Commit and push it (or push to whatever branch the demo agent will read
   from) so it lands in the repo's clone on the next sync.

2. **Create (or reuse) a demo agent.** Skills Lab → Agents → Add Agent —
   any provider/model, a system prompt like "Review this PR for
   architecture violations."

3. **Attach the document.** Open the agent → **Context** tab → select the
   repo → check `specs/architecture-invariants.md` → confirm it shows under
   "Project context" with a nonzero token estimate.

4. **Open a PR that violates the invariant.** In a branch, add a file under
   `api/` that imports something from `db/` directly, e.g.:

   ```ts
   // api/handlers/get-user.ts
   import { queryUsers } from "../../db/users"; // <- violates the invariant
   ```

   Open a PR for that branch against the repo's default branch.

5. **Run the agent** on that PR (PR page → Agent runs → Run Review, or via
   the `devdigest-mcp` `run_agent_on_pr` tool).

6. **Inspect the result:**
   - The review's findings should include one referencing the `api/` →
     `db/` import.
   - Open the run's trace (Agent run → trace tab) → Configuration →
     **Specs read** should list `<owner>/<name>:specs/architecture-invariants.md`.
   - Expand **Prompt assembly** → the row labeled *"Project context —
     attached specs (untrusted)"* → confirm the full invariant text is
     there, wrapped in `<untrusted source="spec-0">…</untrusted>`.
   - Read the finding's `rationale` — it should reference the invariant
     document or restate its rule (exact wording is model-dependent, not
     asserted verbatim — that's why this is a manual check, not an
     automated one, per AC-19's framing).

## What this does NOT prove

- Exact citation wording — that's the model's call, not something this
  feature can guarantee deterministically.
- Grounding behavior in general — that's the existing, unmodified grounding
  gate (`reviewer-core/src/grounding.ts`), out of scope for this demo.

## If the finding doesn't cite the document

Before concluding the feature is broken, check in this order:

1. Trace's "Specs read" is empty → the attach didn't resolve (AC-12) — check
   the repo actually has `specs/architecture-invariants.md` at HEAD and the
   agent's Context tab still shows it checked.
2. "Specs read" has the entry but "Prompt assembly" → specs is empty/absent
   → a bug in `buildProjectContextDigest`'s truncation/budget logic (check
   `MAX_CONTEXT_DOC_CHARS`/`MAX_CONTEXT_DOCS_TOTAL_CHARS` didn't drop it).
3. Both show the text correctly, but the finding still doesn't cite it →
   this is model behavior (prompt engineering), not a mechanism bug — the
   mechanism is proven by (1) and (2) already passing.
