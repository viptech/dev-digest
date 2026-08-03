---
name: pr-self-review
description: Use before running any `gh pr create`/`gh pr edit`/`gh pr` command, before reporting a task, fix, or feature as complete, or when the user asks for a self-review of pending changes — checks the uncommitted diff for surfaces that still need a specialized skill's review before a pull request is opened or updated.
---

# PR Self-Review

## Overview

Second-pass reviewer over the **uncommitted diff**, run right before status is
reported "done" or before a PR is opened/updated. It classifies changed files
by surface (frontend vs backend) and dispatches this project's own domain
skills to review just that diff. A critical finding blocks proceeding until
it's fixed or the user explicitly overrides.

## When to use

- Before saying a task, fix, or feature is complete / "готово" / ready
- Before `gh pr create`, `gh pr edit`, or any command that opens/updates a PR
- When the user explicitly asks for a self-review, or invokes `/pr-self-review`
- **Not** when `git status --porcelain` is empty — nothing to review
- **Not** for reviewing someone else's already-open PR — use the `review`
  skill/command instead

## Process

1. `git status --porcelain` + `git diff HEAD` (staged + unstaged). Empty →
   report clean, nothing to review.
2. Classify every changed path by surface:

   | Path prefix | Surface |
   |---|---|
   | `client/**` | Frontend |
   | `server/**`, `reviewer-core/**` | Backend |
   | anything else (`e2e/**`, root config, docs) | No dedicated skill — note as unreviewed |

3. Run the skills for every surface actually present in the diff — scoped to
   the changed hunks, not the whole codebase:

   | Surface | Skills to invoke |
   |---|---|
   | Frontend | `react-ui-architecture`, `react-best-practices`, `react-testing-library` (for `*.test.*` / `*.spec.*`) |
   | Backend | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` (when `db/schema.ts`, migrations, or query files are touched) |
   | Full-stack (always, whenever the diff is non-empty) | `security`, `zod`, `typescript-expert` |

   Both surfaces touched → run both rows plus full-stack; keep findings
   grouped by surface. Full-stack skills run regardless of which surface(s)
   are present — a security or type-safety issue can land in either.
4. Each skill reviews only the diff against its own checklist and reports
   findings tagged critical/major/minor with `file:line`, using the severity
   criteria below so the threshold doesn't drift skill to skill:

   | Severity | Criteria |
   |---|---|
   | Critical | Breaks an architectural boundary (onion layering, direct DB/adapter access from a route), bypasses the grounding gate or injection guard, introduces a security vulnerability (OWASP-class: injection, auth bypass, secret exposure), or ships broken/untested behavior on the golden path. |
   | Major | Violates a documented convention (wire-contract casing, DI-container resolution, RTL query priority) without breaking anything at runtime; missing test coverage for new logic. |
   | Minor | Style, naming, or non-blocking simplification — would be fine in `simplify` but not worth blocking a PR over. |

   Only **Critical** blocks; Major/Minor are reported but non-blocking.
5. Aggregate. **Any critical finding → stop here.** Do not report the task
   complete, do not run `gh pr create`/`gh pr edit`. Show the findings to the
   user; only continue after they're fixed or the user explicitly says to
   proceed anyway.
6. No critical findings → summarize which skills ran and what they found
   (including "no findings"), then continue to mark the task complete or open
   the PR.

## Red flags — run this first

- About to say "done" / "готово" / "ready" and `git status --porcelain` is non-empty
- About to run any `gh pr` subcommand
- Diff touches both `client/**` and `server/**` but only one surface's skills
  were considered
- "I already reviewed it while writing it" — that's the same pass, not a
  second one

## Rationalization table

| Excuse | Reality |
|---|---|
| "It's a small/one-line change" | Size doesn't predict risk — one line can still cross an onion boundary or break a hooks rule. |
| "I already checked it while writing" | Authoring-time review misses your own blind spots — that's exactly why a second, diff-only pass exists. |
| "No time before the PR" | A critical finding caught here costs a minute; the same finding caught in PR review costs a round trip. |
| "Only one surface changed, skip classification" | Classification is what tells you it's only one surface — do it, then run that surface's skills. |
| "User said skip it" | Only skip after the user has seen the findings and explicitly overrides — never skip silently before findings exist. |

## Common mistakes

- Reviewing the whole codebase instead of just the diff — produces noise
  unrelated to this change and burns time.
- Treating an unmapped path (no surface match) as automatically clean — note
  it as unreviewed, don't silently pass it.
- Downgrading or omitting a critical finding to avoid blocking — always
  surface it; the user decides whether to override.
