---
name: react-ui-architecture
description: Decision framework for where React/Next.js frontend code should physically live — which folder a component, hook, util, constant, or piece of business logic belongs in, and when to promote something from feature-local to shared. Use this whenever creating a new component or page, deciding where to put a helper/constant/hook, splitting a component that's grown too big, or reviewing an existing frontend for structure/placement problems (misplaced files, deep cross-feature imports, fat page files, logic stuck in JSX). Triggers on phrases like "where should this component go", "how should I split this up", "where do utils/constants live", "is this the right folder structure", "app-router colocation", "feature folder", as well as silent structural smells you notice while editing frontend code — you don't need the user to name the skill explicitly.
---

# React UI architecture

A folder-structure decision is really a *coupling* decision: where you put a
file declares who's allowed to depend on it casually. Every rule below exists
to keep that declaration honest — so a file's location tells you its blast
radius without having to trace imports.

Two ideas do almost all the work:

1. **Colocate by default.** Put code as close as possible to the single place
   that uses it (Kent C. Dodds' colocation heuristic — see
   `references/sources.md`). Distance from point of use should be
   proportional to how widely something is actually shared, not to a guess
   about future reuse.
2. **Promote on the second user, not the first.** A component/hook/util stays
   local to the feature or route that needs it. The moment a *second*,
   unrelated feature needs the same thing, move it up to the shared layer.
   Promoting speculatively (because it "feels reusable") produces a shared
   folder full of one-off abstractions nobody trusts; promoting late produces
   copy-paste drift. Both are worse than waiting for the real second caller.

If you only remember one thing: **don't decide where something belongs by
guessing at its future — decide by counting its current callers.**

## Which stack variant applies

- **Next.js App Router** (this repo's stack, and the default recommendation
  for new projects) → read `references/nextjs-app-router.md` for the
  concrete folder shapes, private-folder (`_folder`) rules, and route-group
  conventions.
- **Vite / CRA / any non-file-system-router SPA** → read
  `references/general-react-spa.md` for the feature-folder shape without
  framework-provided routing conventions.

Both variants share the decision framework below; they differ only in *what
the shared layer and the route/page layer are called on disk*.

## The layer model

Three layers, strict one-way dependency:

```
shared  →  feature / route  →  app (composition root)
```

- **shared** — framework-agnostic-ish, reusable across ≥2 features: generic
  UI primitives, cross-cutting hooks, pure utils, shared types/constants.
- **feature / route** — everything that exists to serve one page or one
  business capability: colocated components, hooks, helpers, constants,
  tests.
- **app** — routing/composition only: assembles features into pages, wires
  providers, passes props down. Should be boring to read.

Rules that follow from this:
- Shared code may be used by anything. Feature code may use shared code.
  Feature code should **not** import from another feature's internals — if
  two features need the same thing, that's the promotion signal, not a
  reason to reach across the boundary. Compose at the app/page level instead.
- Route/page files (`page.tsx`, top-level route components) stay thin: they
  fetch/compose and render, they don't contain the logic. If a page file is
  hard to summarize in one sentence, logic has leaked into it that belongs in
  a colocated component or hook.
- Avoid deep barrel files that re-export a whole feature or domain (tree-shaking
  and circular-import hazards). A single `index.ts` at a *component's own*
  folder boundary (re-exporting just that component) is fine and common;
  a `index.ts` at a *feature's* root that re-exports everything inside it is
  the pattern to avoid.

## Where does X go? (decision table)

Read top to bottom — stop at the first row that matches.

| You're placing... | Used by exactly one component/page/feature | Used by 2+ features |
|---|---|---|
| A component | Colocate it in that component/feature's own folder | Promote to the shared components layer |
| A pure helper function (no JSX, no hooks) | `helpers.ts` (or `utils.ts`) colocated with the feature | Shared `lib/utils/` (or equivalent) |
| A constant / enum / magic string | `constants.ts` colocated with the feature | Shared `lib/constants/` (or equivalent) |
| A hook that wraps local UI state | Colocate with the component that owns the state | Shared `hooks/` — but check first whether it's really UI-state-shaped, or should be a data hook (below) |
| A hook that fetches/mutates server state | Almost always belongs in the shared data-hook layer (e.g. `lib/hooks/`) even with one caller today — server state is inherently a cross-cutting concern, not a UI concern | Same location |
| Business logic (calculations, validation, orchestration not tied to rendering) | A plain function, colocated — never inline inside a component body or JSX | Promote to a shared module once 2+ features need the same rule; keep it framework-agnostic (no React imports) so it stays trivially testable |
| A test | Colocated next to the unit it tests (`<Name>.test.tsx` beside `<Name>.tsx`), not in a parallel `__tests__` tree | Same — tests don't get "promoted", they just move with their subject |
| Types | Colocated if feature-specific | Shared `types/` if the type crosses a feature boundary (e.g. an API contract) |

The "business logic" row is the one worth dwelling on: **if you can't unit
test a piece of logic without rendering a component, it's still tangled with
the UI.** Extracting it into a plain function (or a hook, if it needs
lifecycle/state) and colocating that function is what actually buys you
testability — moving it to a shared folder before extracting it just moves
the tangle.

## Naming conventions

- **Component files/folders:** PascalCase (`AgentCard.tsx`, folder
  `AgentCard/`). The component name, its file name, and (if folder-per-component)
  its folder name should all match — that's what makes fuzzy-finding in an
  editor reliable.
- **Hooks:** camelCase, `use` prefix (`useRepos.ts`).
- **Non-component files** (`helpers.ts`, `constants.ts`, `types.ts`): lowerCamelCase
  or plain lowercase, consistent across the codebase — pick one and don't mix.
- **Test files:** `<SubjectFileName>.test.tsx` (or `.test.ts`), colocated.
- Whatever convention an existing codebase already uses, follow it — these
  are defaults for new projects, not a mandate to rename things you encounter
  mid-task. See "Reviewing existing structure" below for how to handle
  mismatches.

## Reviewing existing structure (not just creating new code)

When touching a frontend file, notice these smells and flag or fix them
(scope permitting — a drive-by rename of unrelated files is its own kind of
mess, so weigh the fix against the size of the task you're actually doing):

- **A component/util lives inside one feature's folder but is imported by
  another feature.** This is the promotion signal arriving late — the import
  itself is evidence of the second caller. Promote it to the shared layer as
  part of the change, don't leave the cross-feature import in place.
- **A relative import climbs out of one feature and into another**
  (`../../other-feature/...`). Same signal as above, just via `../` instead
  of an alias.
- **A `page.tsx` / top-level route file is doing real work** — data
  transformation, conditional rendering trees, inline business rules. Extract
  into a colocated component or hook; the page should read as a table of
  contents for the route, not its implementation.
- **A `utils.ts` file imports React or returns JSX.** That's not a util,
  it's a component or hook wearing a utils hat — rename/move it accordingly,
  since "utils" implies plain-function, framework-agnostic, trivially
  testable code.
- **A shared folder has an entry used by only one feature.** Demotion is
  rarer than promotion but real — if reuse never materialized and the single
  caller has drifted from what the "shared" version assumes, pull it back
  into that feature rather than contorting the shared version with flags.
- **Two features have near-duplicate copies of the same helper.** That's a
  missed promotion, not a coincidence — consolidate into the shared layer.

## Sources

This skill's rules are synthesized from established, current guidance rather
than invented from scratch. Full list with what each source contributes is in
`references/sources.md` — check it before treating any rule here as final if
a project's existing convention conflicts with it; the *why* in the source
usually resolves the conflict faster than debating from first principles.
