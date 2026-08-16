# Cross-model review — SPEC-04 Development Plan

**Date:** 2026-08-13
**Reviewed artifact:** `.claude/plans/spec-04-pr-why-risk-brief.md` (commit `d973a52`)
**Reviewer:** Claude Opus 5 session (different model from the plan's author, Sonnet 5) — no other foundation-model provider is wired into this environment, so this is the same "different underlying model, different session" substitute the SPEC-03 checkpoint used.
**Method:** Read `docs/specs/SPEC-04-pr-why-risk-brief.md` and the plan in full; cross-checked every load-bearing `file:line` claim in the plan against the actual code (`server/src/modules/brief/**`, `server/src/vendor/shared/contracts/brief.ts` + client copy, `reviewer-core/src/{index,prompt}.ts`, `client/src/app/repos/[repoId]/pulls/[number]/**`, `client/src/components/diff-viewer/**`).

## Context

This is the mandatory, committed plan-review checkpoint the L05 homework requires before any feature code lands (T11 of the spec, distinct from SPEC-03's own best-effort same-session recommendation). The reviewer was asked to find AC coverage gaps, factual mismatches between the plan and the real code, internal contradictions, and unresolved-but-consequential design decisions — not style feedback.

## Findings

**5 blockers** (each would have broken a specific AC or made a specific spec-mandated demo step unreachable if shipped as originally planned):

- **B1** — `PrBriefCard`'s existing early `return null` when `review_rollup` is absent would have hidden the "No brief yet" empty state for any PR without a review, making AC-16 and the entire T12 demo script ("open a PR with no brief, click Generate") unreachable.
- **B2/B3** — the original T10 file-navigation plumbing was factually wrong about `FileCard`'s real effect condition, and dropped the incrementing nonce the plan's own text explained was necessary for repeat-click re-triggering. AC-20 as originally planned would not have worked.
- **B4** — `BriefRepository.upsert` never passed `createdAt` into the UPDATE branch, so Drizzle's `.defaultNow()` would have silently frozen the cached timestamp at first generation, contradicting the plan's own regenerate test and AC-10/AC-8.
- **B5** — three mutually-incompatible descriptions of exactly where `INJECTION_GUARD` gets appended to the prompt left real doubt it would reach the LLM call at all — a direct NFR-HIGH (prompt injection) risk, not a cosmetic gap.

**6 majors** — most consequentially, **M1**: the plan initially treated the PR's persisted Intent record and the Blast Radius summary as "server-computed, not third-party content" and left them unwrapped, when this codebase's own established rule (`reviewer-core/src/prompt.ts`'s own `wrapUntrusted('intent', ...)` precedent) explicitly says LLM-derived-from-untrusted-text output never becomes trusted just because a model produced it once already. Also: **M2** (the 8000-token budget check ignored the system prompt, against AC-2's literal wording), **M3** (a failed Regenerate would have wiped a still-valid cached brief from the UI instead of just showing a retry message), **M4/M6** (two Edge-cases the spec explicitly allows — a PR with no Intent record, a review row with a null `agentId` — weren't handled).

**6 minors** — a stale test fixture that would have failed `pnpm typecheck`, a wrong `INSIGHTS.md` cross-reference, a "shared style helper" that doesn't actually exist as a shared export, two AC mislabels, and a missing normalization step for endpoint-string grounding.

Full finding-by-finding detail (severity, exact `plan:line` / `spec:line` locations, and the concrete fix each one required) is preserved in this session's transcript, not duplicated here — this note records the review's occurrence and outcome, not a second copy of the findings themselves.

## Resolution

All 5 blockers and all 6 majors were fixed directly in `.claude/plans/spec-04-pr-why-risk-brief.md`, committed separately as `fb586c5` ("docs(plans): address cross-model review findings (SPEC-04)") — the plan file itself, not this note, is the artifact of record for exactly what changed and why. All 6 minors were fixed in the same commit except two explicitly left alone per the reviewing session's own scoping (a wrong spec cross-reference to be fixed in the spec itself later, not the plan; a factually-correct-as-is cosmetic note about tooling availability).

No finding was dismissed without a documented reason. No finding was silently fixed in code later instead of in the plan — this was a pre-code checkpoint, and commit `fb586c5` landed before any feature-code commit (the pipeline table's commit 3) began.
