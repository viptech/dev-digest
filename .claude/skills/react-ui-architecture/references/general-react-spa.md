# General React SPA shape (Vite / CRA / no file-system router)

Without a framework-provided routing convention (no private folders, no route
groups), the "route/page layer" from `SKILL.md` becomes an explicit
**feature folder**, following the pattern popularized by
[bulletproof-react](https://github.com/alan2207/bulletproof-react) — see
`sources.md`. Same three-layer model, different names on disk.

## Folder shape

```
src/
  app/                 # routing, root providers, router config — the
                        # composition root; imports from features + shared
  features/
    <feature-name>/
      components/       # feature-specific components
      hooks/            # feature-specific hooks
      api/              # feature-specific API calls/hooks
      helpers.ts         # or utils.ts — pure functions used only here
      constants.ts
      types.ts
      index.ts           # public API of the feature — what other layers
                          # are allowed to import; keep this the ONLY
                          # cross-boundary import point (see below)
  components/           # SHARED components (2+ features)
  hooks/                # SHARED hooks
  lib/                  # SHARED preconfigured libraries (query client, etc.)
  utils/                # SHARED pure helpers (2+ features)
  types/                # SHARED types
  config/               # env/config
```

Only include the subfolders a given feature actually needs — an empty
`api/` folder because "it might need one later" is the same speculative-reuse
mistake as premature promotion, just one level down.

## The one place a feature-root barrel is fine

`SKILL.md` warns against deep barrels that re-export a whole feature. The
exception: a feature's own `index.ts` acting as its **public API surface** —
other features/the app layer import *only* from `features/<name>/index.ts`,
never reaching into `features/<name>/components/Foo.tsx` directly. That's not
a tree-shaking-hazard barrel, it's an access-control boundary: it makes "what
does this feature expose" a single file you can read, and it's what makes
the "features don't import each other's internals" rule enforceable instead
of aspirational. Consider an ESLint rule like `import/no-restricted-paths` to
make the boundary machine-checked rather than convention-only, especially on
a team of more than one or two people.

## Applying the promotion rule here

- A component used only within `features/agents/` → `features/agents/components/`.
- A second feature needs the same component → move it to `src/components/`;
  update both features' imports.
- A pure helper used only in `features/agents/` → `features/agents/helpers.ts`.
- The same calculation needed by `features/repos/` too → promote to
  `src/utils/`.

## When to reach for Feature-Sliced Design instead

If a project has outgrown a flat `features/` folder — many features, real
cross-feature composition, multiple teams needing enforced boundaries — the
next step up is [Feature-Sliced Design](https://feature-sliced.design/) (FSD,
see `sources.md`), which formalizes the same shared → feature → app direction
into explicit layers (`shared`, `entities`, `features`, `widgets`, `pages`,
`app`) with a stricter, tool-enforceable dependency graph. Don't adopt FSD's
full layer set for a small/medium app by default — it's real process
overhead that only pays off once the plain feature-folder shape starts
straining under its own size. Recognize that moment by the same smells listed
in `SKILL.md`'s "Reviewing existing structure" section showing up
persistently despite promotion discipline, not by app size alone.
