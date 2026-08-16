# Development Plan — SPEC-02 Project Context gaps (T1–T5)

**Execution mode:** single-agent

## Context

`docs/specs/SPEC-02-project-context-gaps.md` (Status: ready, all Open
questions resolved 2026-08-13) is a small increment on top of the already-
`implemented` `docs/specs/SPEC-01-project-context.md`. Three L05 demo
requirements were reconciled against the actual shipped code; two came back
with a confirmed, narrow gap between what SPEC-01 asked for (or silently
didn't ask for) and what the UI actually shows:

- The Project Context page (`/repos/:repoId/context`) exists and works, but
  has **no navigation entry** — no sidebar item, no `⌘K` command, no `g`
  shortcut. Reachable only by typing the URL directly.
- The "Used by N agents" counter and the `ContextDocPicker`'s "N of M
  attached" badge are **not reactively invalidated** after an agent/skill
  context-doc mutation — they only refresh after the 30s `staleTime` lapses
  or a hard refresh, because `useSetAgentContextDocs`/`useSetSkillContextDocs`
  only call `qc.setQueryData(...)` on their own query key, never touching
  `["repo-context-docs", repoId]`.
- The Agent editor's Context tab shows a badge that counts **only the
  agent's own attached documents** (`ContextDocPicker.tsx:69-93`), never the
  documents inherited from linked + enabled skills — even though the actual
  prompt build at run time (`ProjectContextService.resolveAgentContext`,
  `server/src/modules/project-context/service.ts:213-232`) already unions
  and dedupes both. The demo wants that combined number visible in the tab
  itself, before a run, not only in a completed run's trace.

This plan covers exactly T1–T5 from SPEC-02's task checklist — a nav entry,
two cache-invalidation fixes, one client-side aggregation feature, and its
i18n strings. It does **not** touch discovery, backend resolution, the
run-executor, `RunTrace`, or any SPEC-01 AC (1–19) — those are confirmed
implemented and out of scope here.

Codebase read confirms every SPEC-02 `file:line` citation still holds
(`client/src/vendor/ui/nav.ts`, `client/src/lib/hooks/agents.ts:133-142`,
`client/src/lib/hooks/skills.ts:78-87`, `client/src/lib/providers.tsx:28-29`,
`client/src/components/context-doc-picker/ContextDocPicker.tsx:69-93,168-172`,
`client/src/app/skills/_components/SkillDrawer/SkillDrawer.tsx:175-186`,
`.../SkillsTab/SkillsTab.tsx:17-18,67,77`) — no drift between the spec and
the real code was found, so no scope renegotiation is needed.

**User-confirmed decisions carried into this plan (2026-08-13, this session):**
- The aggregate badge (T4) renders inside `ContextTab.tsx`, next to (not
  inside) the shared `<ContextDocPicker>` — `ContextDocPicker` itself is
  **not modified**, since it's also used by `SkillDrawer.tsx`, which has no
  "linked skills" concept.
- The new nav item's icon (T1) is `"FileText"` — same icon the Agent
  Editor's own Context tab already uses
  (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:14`),
  for visual consistency between the two "Context" surfaces.

## Modules involved

**`client` only.** No server, no `reviewer-core`, no `e2e`, no shared
contracts (`server/src/vendor/shared` / `client/src/vendor/shared`) — SPEC-02's
own NFR ("Не змінювати серверний контракт") confirms `AgentContextDocLink`,
`SkillContextDocLink`, and `SetContextDocsBody`
(`client/src/vendor/shared/contracts/project-context.ts`) need no new field;
T4's aggregation is a client-only computation over already-fetched data.

## Constraints

- **Feature-folder shape** (`client/CLAUDE.md:9-12`): keep `ContextTab.tsx`
  thin-ish, put the aggregation logic in a colocated `helpers.ts` (doesn't
  exist yet in `ContextTab/` — only `ContextTab.tsx`, `index.ts`, `styles.ts`
  exist today) rather than inlining a nontrivial dedup algorithm in the
  component body.
- **`../` import-depth gotcha** (`client/INSIGHTS.md`, 2026-08-02 entries ×2):
  `ContextTab.tsx` is at the same nesting depth as `SkillsTab.tsx`
  (`src/app/agents/[id]/_components/AgentEditor/_components/<Tab>/<Tab>.tsx`).
  Its *existing* imports already prove the correct depth for `lib/hooks/*`:
  `"../../../../../../../lib/hooks/agents"` (7 `../`). Reuse that exact
  prefix for the new `"../../../../../../../lib/hooks/skills"` import —
  do not recompute by eyeballing; a wrong depth silently fails to mock in
  tests (resolves to a different module path) rather than erroring at
  typecheck.
- **Rules of hooks** (not spelled out literally in SPEC-02's T4 wording,
  but required by its own NFR): the task text says "для кожного [enabled
  linked skill] — `useSkillContextDocs(skillId)`" — calling an existing
  single-id hook inside a `.map()` over a list whose length can change
  across renders (skills get linked/unlinked) is unsafe (variable number of
  hook calls per render). SPEC-02's NFR itself points at the correct
  pattern: reuse `useContextDocsCharsMap`'s `useQueries`-based shape
  (`client/src/lib/hooks/project-context.ts:53-68`) instead — see Ordered
  steps, T4.
- **Dedup must mirror the server, not just pass the one example in the
  spec's test note.** `ProjectContextService.resolveAgentContext`
  (`server/src/modules/project-context/service.ts:213-232`) unions agent's
  own docs (kept in agent order) with every enabled linked skill's docs (in
  skill-link order, then per-skill doc order), and dedupes on
  `(repo_id, path)` keeping the **first** occurrence overall — this includes
  two different linked skills sharing the same doc, not only the
  agent-vs-one-skill case the spec's suggested test asserts. Implement the
  same "seen-set, first-occurrence-wins" walk client-side (agent docs first,
  then each enabled linked skill in link order, each skill's own docs in
  saved order) so AC-26 holds for skill-vs-skill collisions too, not only
  the literal test case named in the checklist.
- **Cache-invalidation scope (NFR, "Продуктивність кеш-інвалідації")**: must
  not be an unscoped `queryClient.invalidateQueries()`. Since
  `useSetAgentContextDocs`/`useSetSkillContextDocs`'s mutation response only
  reflects the *new* set of docs (a fully-detached repo would vanish from it,
  so deriving the affected `repoId` set purely from `variables`/`data` misses
  that case), use the NFR's explicitly-permitted fallback instead: a
  predicate scoped to the exact query-key head `"repo-context-docs"` —
  `qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "repo-context-docs" })`.
  This is still narrow (it does **not** touch `"repo-context-doc-content"`,
  `"agents"`, `"skills"`, `"agent-skills"`, etc. — different first key
  element), and it's correct for every case (attach/detach/reorder, single-
  or cross-repo), unlike a repoId-diff that would need the pre-mutation
  cache snapshot to catch a fully-detached repo.
- **`AgentSkillLink` has no `enabled` field of its own**
  (`client/src/vendor/shared/contracts/knowledge.ts:194-199`) — "enabled" is
  a property of the `Skill` itself (`useSkills()`), not of the link. T4 must
  filter linked skill ids against `allSkills.find(s => s.id === id)?.enabled`,
  the same join `SkillsTab.tsx:41-45` already does for its own render order,
  not against anything on `AgentSkillLink`.
- **Do not touch anything in SPEC-01's scope** — discovery
  (`project-context/discovery.ts`), the `project-context` server module,
  `run-executor.ts`'s `buildProjectContextDigest`, `RunTrace`/`PromptAssembly`
  contracts, or `ContextDocPicker.tsx`/`SkillDrawer.tsx` themselves (beyond
  what SPEC-02 literally asks) are all out of scope and already verified
  working.

## Skills to apply

- **`react-best-practices`** — the rules-of-hooks constraint above (no
  `.map()` over a dynamic list calling a per-item hook) is exactly this
  skill's territory; apply it when adding the new skills-context-docs
  aggregation hook.
- **`react-ui-architecture`** — governs the already-confirmed decision to
  keep the aggregate badge in `ContextTab.tsx` rather than inside the shared
  `ContextDocPicker`, and to extract the dedup algorithm into a colocated
  `helpers.ts` per the feature-folder convention.
- **`react-testing-library`** — T1–T3 introduce genuinely new test
  locations/patterns in this codebase (no existing `client/src/lib/hooks/*.test.ts`
  or `client/src/vendor/ui/*.test.ts` files today); use this skill for the
  `renderHook` + `QueryClientProvider` wrapper pattern for the two hook
  tests, and RTL query conventions for `nav.test.ts`'s assertions and the
  extended `ContextTab.test.tsx`.
- **`engineering-insights`** — per root `CLAUDE.md`'s session protocol,
  invoke at the end of this task if anything non-obvious surfaces during
  implementation (the rules-of-hooks correction to T4's literal wording, or
  the invalidation-scope reasoning above, are plausible candidates — record
  only if they actually cost real effort to work out, not by default).
- **`pr-self-review`** — run before opening/updating any PR for this change,
  per its own trigger condition.

## Ordered steps

### T1 — nav entry (`client/src/vendor/ui/nav.ts`)

1. Add a new `NavItemDef` as the **second** entry of the `WORKSPACE` group
   (right after `pulls`):
   `{ key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context", gKey: "x" }`.
2. Add `{ keys: "g x", label: "Go to Project Context", group: "Navigation" }`
   to `SHORTCUTS`, next to the existing `g p`/`g a`/`g s`/`g c` entries.
3. No other file changes needed for T1: `Sidebar.tsx` renders `NAV` directly
   (`client/src/vendor/ui/shell/Sidebar.tsx:45-69`); `useShellCommands.ts`
   builds one command per `NAV` item and resolves its label via
   `t(\`nav.${it.key}\`)` (`client/src/components/app-shell/hooks/useShellCommands.ts:21-29`),
   which already finds `nav.context` in `client/messages/en/shell.json:20`.
4. Add `client/src/vendor/ui/nav.test.ts` (new file — no prior nav test
   exists) asserting: `WORKSPACE` group contains a `key: "context"` item
   with `gKey: "x"`, positioned second (index 1) after `pulls`;
   `resolveHref(item.href, "repo1")` yields `"/repos/repo1/context"`;
   `SHORTCUTS` contains an entry with `keys: "g x"`.

### T2 — invalidate `["repo-context-docs", repoId]` after agent doc mutation (`client/src/lib/hooks/agents.ts:133-142`)

1. In `useSetAgentContextDocs`'s `onSuccess`, alongside the existing
   `qc.setQueryData(["agent-context-docs", agentId], data)`, add
   `qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "repo-context-docs" })`.
2. Add `client/src/lib/hooks/agents.test.ts` (new file) covering only
   `useSetAgentContextDocs` (not the whole module): mock `../api`'s
   `api.post` to resolve with a fixture `AgentContextDocLink[]`; render the
   hook with `renderHook` under a real `QueryClient` (not mocked) wrapped in
   `QueryClientProvider`; pre-seed `qc.setQueryData(["repo-context-docs", "repo1"], [...])`;
   call `result.current.mutate([...])`; after it resolves, assert
   `qc.getQueryState(["repo-context-docs", "repo1"])?.isInvalidated === true`.

### T3 — same fix, symmetrically, for skill doc mutation (`client/src/lib/hooks/skills.ts:78-87`)

1. Same one-line addition to `useSetSkillContextDocs`'s `onSuccess`.
2. Add `client/src/lib/hooks/skills.test.ts` (new file, `useSetSkillContextDocs`
   only) mirroring T2's test shape.

### T4 — aggregate agent+skills counter in `ContextTab.tsx`

1. Add a new hook `useSkillsContextDocs(skillIds: string[])` to
   `client/src/lib/hooks/skills.ts`, next to the existing single-id
   `useSkillContextDocs`, following the exact `useQueries` shape of
   `useContextDocsCharsMap` (`client/src/lib/hooks/project-context.ts:53-68`):
   one query per id with the *same* query key shape as
   `useSkillContextDocs` (`["skill-context-docs", skillId]`) so the cache is
   shared, no double-fetch. Return a `Map<string, SkillContextDocLink[]>`
   keyed by `skillId` (docs sorted by their own `order` inside each entry,
   matching what `useSkillContextDocs` itself returns unsorted from the API —
   sort here or leave sorting to the consumer, whichever this hook's
   existing sibling `useContextDocsCharsMap` convention nudges toward; keep
   it simple).
2. In `ContextTab.tsx`, alongside the existing `useAgentContextDocs(agentId)`:
   - `useAgentSkills(agentId)` → linked `{skill_id, order}[]`
     (`client/src/lib/hooks/agents.ts:101-107`).
   - `useSkills()` → all workspace skills with `enabled`
     (`client/src/lib/hooks/skills.ts:9-14`).
   - Filter linked skill ids to only those whose matching `Skill.enabled`
     is `true` (join on `allSkills`, same as `SkillsTab.tsx:41-45`'s
     `linkedIds.map(id => allSkills?.find(...))` pattern), preserving link
     order.
   - `useSkillsContextDocs(enabledLinkedSkillIds)` from step 1.
3. Add `ContextTab/helpers.ts` (new file) exporting a pure function, e.g.
   `aggregateContextDocCount(ownDocs: AgentContextDocLink[], linkedSkillIdsInOrder: string[], skillDocsById: Map<string, SkillContextDocLink[]>): { own: number; fromSkills: number; total: number }`
   implementing the seen-set/first-occurrence-wins walk from Constraints
   above (own docs first, then each linked-enabled skill's docs in link
   order, own doc order per skill) — this is what makes AC-26 (agent-vs-
   skill AND skill-vs-skill collisions) hold, not just the naive
   `own.length + Σ skill.length` sum the NFR explicitly warns against.
4. Render the result next to `<ContextDocPicker>` in `ContextTab.tsx`: main
   badge `t("aggregateBadge", { count: total })`, and — only when
   `fromSkills > 0` — a muted subtitle
   `t("aggregateBreakdown", { own, fromSkills })` right under/beside it (per
   AC-24's exact copy decision — no breakdown line at all when
   `fromSkills === 0`, per the Edge case).
5. Extend the existing `ContextTab.test.tsx` (it currently mocks
   `useAgentContextDocs`/`useSetAgentContextDocs`, `useRepos`, and the
   `project-context` hooks module, but not `useAgentSkills`/`useSkills`/the
   new `useSkillsContextDocs` — those mocks need to be added for the
   existing tests to keep passing): add a case for 1 own doc + one enabled
   linked skill with 2 docs → renders `"3 attached"` and the breakdown
   subtitle `"1 from this agent + 2 from linked skills"`; a dedup case where
   the same `(repo_id, path)` is attached both on the agent and via a
   linked skill → counts once (AC-26); a disabled-linked-skill case → its
   docs excluded entirely from the count (Edge case); a no-linked-skills (or
   only disabled ones) case → renders only `"N attached"`, no breakdown line
   at all (Edge case, `fromSkills === 0`).

### T5 — new i18n keys (`client/messages/en/projectContext.json`)

1. Add two new keys, distinct from the existing `attachedBadge`/
   `nOfMAttached` (which stay untouched — they back the *own-only* count
   inside `ContextDocPicker`, still correct per SPEC-01 AC-5, unchanged by
   this spec):
   - `"aggregateBadge": "{count} attached"`
   - `"aggregateBreakdown": "{own} from this agent + {fromSkills} from linked skills"`
2. No changes needed to `client/messages/en/shell.json` (T1's `nav.context`
   key already exists) or any other locale file — this codebase currently
   ships only `en` messages.
3. Covered by T4's extended `ContextTab.test.tsx` (`getByText` on the badge
   and the breakdown string) — no separate test file for i18n.

### Self-verification (folds in for single-agent mode)

- After each T, re-read the touched file once to confirm the edit matches
  what's described above (no separate implementer/verifier hand-off exists
  in this run).
- Run the exact commands in Test plan below and paste their pass/fail
  summary into the final report.
- If, while implementing, something looks like it needs an
  architecture/security second opinion after all (e.g. an unexpected touch
  outside `client/`), say so explicitly in the final report rather than
  silently proceeding or silently skipping it.

## Test plan

Per `TESTING.md`'s client suite (component/unit, jsdom, `fetch` mocked — no
API/DB needed):

```sh
cd client && pnpm test        # vitest — must include the new/extended files:
                               #   src/vendor/ui/nav.test.ts
                               #   src/lib/hooks/agents.test.ts
                               #   src/lib/hooks/skills.test.ts
                               #   .../ContextTab/ContextTab.test.tsx (extended)
cd client && pnpm typecheck    # must stay clean — new hook (useSkillsContextDocs),
                               # new helpers.ts, new i18n keys must typecheck
```

A pass means: all vitest suites green (including the four
new-or-extended files above), zero typecheck errors. No server/reviewer-core/
e2e suites are affected by this change — do not run them as part of this
task's verification (they're unrelated to a client-only diff), though
running `cd client && pnpm test` alone is sufficient to prove this plan's
scope.

## Out of scope

Architecture review and security review are **not** part of this plan or
its executing agent's job — per the user's explicit choice for this run
(client-only, UI-aggregation scope, no onion-architecture or trust-boundary
surface touched), no separate `plan-verifier`/`architecture-reviewer` pass
is scheduled. If the implementing agent discovers mid-task that something
here genuinely needs that review after all, it must say so plainly in its
final report rather than silently proceeding or silently dropping it — per
the user's own instruction for this run.
