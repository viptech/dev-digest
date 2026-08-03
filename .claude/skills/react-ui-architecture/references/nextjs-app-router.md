# Next.js App Router shape

This is the concrete folder shape for the "colocate by default, promote on
the second user" rules in `SKILL.md`, applied to Next.js's App Router. It
also happens to match this repo's `client/CLAUDE.md` convention (see the
worked example at the bottom) — if you're touching `client/**` here, this
is not just a general recommendation, it's what's already in place.

## The two framework primitives that make colocation safe

Next.js treats every folder under `app/` as a potential route segment, which
would normally make "just put a file next to the route" dangerous — a
stray `Card.tsx` could collide with a future file convention. Two conventions
neutralize that:

- **Private folders** (`_folderName`) — prefixing a folder with `_` opts it
  and everything under it out of routing entirely. This is the standard home
  for anything colocated with a route that isn't itself a route: components,
  hooks, helpers, constants.
- **Route groups** (`(folderName)`) — wrapping a folder in parens groups
  routes for organization or shared layouts *without* adding a URL segment.
  Useful for splitting routes by section/team or giving a subset of routes
  their own root layout; not a place for non-route files (that's what private
  folders are for).

Because colocated files inside `app/` are only ever shipped to the client if
a `page.tsx`/`route.ts` actually exports them, colocation here is safe by
default even without the underscore — but the underscore is worth using
anyway: it disambiguates "this is intentionally not a route" from "someone
forgot to add a `page.tsx`," and it groups cleanly in the file tree.

## Folder shape

```
src/
  app/
    <route-segment>/
      page.tsx                  # thin: fetch/compose, render
      layout.tsx                # shared chrome for this segment + children
      _components/
        <ComponentName>/
          <ComponentName>.tsx
          index.ts               # re-export just this component
          helpers.ts             # optional: pure functions used only here
          constants.ts           # optional: constants used only here
          <ComponentName>.test.tsx
      _lib/                      # optional: route-specific non-component logic
  components/                    # SHARED components (used by 2+ routes/features)
    <ComponentName>/
      <ComponentName>.tsx
      index.ts
      <ComponentName>.test.tsx
  lib/
    hooks/                       # SHARED hooks — data hooks live here even
                                  # with one caller today (server state is
                                  # cross-cutting, see SKILL.md)
    utils/                       # SHARED pure helpers (2+ callers)
    constants/                   # SHARED constants (2+ callers)
    api.ts                       # single fetch/client boundary data hooks wrap
  types/                         # types that cross feature/route boundaries
```

## Applying the promotion rule here

- A component only `page.tsx` A uses → `A/_components/<Name>/`.
- The same shape of card now needed by route B too → move it to
  `src/components/<Name>/` and have both routes import from there.
- A data-fetching hook (`useRepos`, `usePullRequest`) → `src/lib/hooks/`
  from the start, per the data-hook row in `SKILL.md`'s table, even for a
  single route — this keeps `src/lib/api.ts` as the single fetch boundary and
  means the *next* route that needs the same data doesn't duplicate the
  fetch logic.
- A validation/formatting function used only inside one component →
  `helpers.ts` next to that component; promote to `lib/utils/` once a second
  component (in any route) needs it.

## Worked example from this repo

`client/CLAUDE.md` documents exactly this shape already:

> Feature-folder shape: pages (`src/app/**/page.tsx`) stay thin; feature
> logic sits in colocated `_components/<Name>/` folders containing
> `<Name>.tsx`, `index.ts`, and — as needed — `styles.ts`, `helpers.ts`,
> `constants.ts`, `<Name>.test.tsx`. Data hooks live in `src/lib/hooks/*`
> over `src/lib/api.ts`.

Concretely, in `client/src/`:

```
app/agents/_components/AgentCard/          # used only by the agents route
app/agents/_components/AgentsListView/
app/agents/[id]/_components/
app/onboarding/_components/AddRepoView/
components/app-shell/                      # cross-cutting chrome, used everywhere
components/diff-viewer/                    # shared across the PR detail route's tabs
components/findings-tooltip/
lib/hooks/                                 # useRepos, usePullRequest, etc.
```

`components/diff-viewer/` is itself a good example of *internal* structure
once a shared component gets non-trivial: it has its own
`CodeLine/`, `CommentCard/`, `CommentThreadView/`, `FileCard/`,
`InlineComposer/`, `OutdatedComments/` subfolders — sub-components that are
only meaningful inside the diff viewer stay nested there rather than
flattening into the top-level `components/` folder, because their caller
count is "one shared component," not "one route."
