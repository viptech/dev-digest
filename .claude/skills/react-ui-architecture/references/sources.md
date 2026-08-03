# Sources

What each source contributed to this skill, and where to go for more detail
than `SKILL.md`/the stack-specific reference files carry.

## Colocation heuristic

- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation) —
  origin of the "place code as close to where it's relevant as possible"
  heuristic this skill treats as the default. The core argument: distance
  between related pieces of code should track how tightly they're coupled,
  not an org chart or a folder taxonomy decided up front.

## Feature-folder / bulletproof-react

- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) —
  source of the `shared → features → app` unidirectional-import rule, the
  `src/features/<name>/{api,components,hooks,stores,types,utils}` shape used
  in `general-react-spa.md`, the "don't import across features, compose at
  the app level" rule, and the barrel-file tree-shaking warning.
- [React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) —
  source of the "promote once a second feature needs it" framing (stated
  there as: a util lives in the feature until a second feature needs it, then
  moves to shared), the four structure tiers by project size (component-based
  → technical-separation → feature-driven → domain-based), and the naming
  convention notes (kebab-case files, singular folder names, colocated tests
  and styles).

## Next.js App Router

- [Next.js docs — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) —
  official source for private folders (`_folder`), route groups
  (`(folder)`), the colocation-safety guarantee (only `page.tsx`/`route.ts`
  exports ship to the client), and the three high-level organization
  strategies (files outside `app`, files in `app` root, split by
  feature/route). Next.js is explicitly unopinionated beyond providing these
  primitives — this skill's Next.js reference picks one opinionated shape
  (route-colocated `_components/`) consistent with this repo's existing
  convention, not the only shape the framework allows.

## Feature-Sliced Design

- [Feature-Sliced Design — official docs](https://feature-sliced.design/) and
  [The Perfect Folder Structure for Scalable Frontend](https://feature-sliced.design/blog/frontend-folder-structure) —
  source of the layered model (`app`, `processes`, `pages`, `widgets`,
  `features`, `entities`, `shared`), the strict one-way dependency graph
  between layers, and the "public API via index.ts" pattern for
  feature/entity boundaries. Referenced as the "next step up" for projects
  that outgrow a flat feature-folder shape, not adopted wholesale by default.

## Survey / cross-check sources

Used to confirm the above wasn't idiosyncratic to one author, and to pull the
"business logic separated from UI" and "utils = pure, framework-agnostic"
framing:

- [React Architecture Patterns and Best Practices for 2026 — Bacancy Technology](https://www.bacancytechnology.com/blog/react-architecture-patterns-and-best-practices)
- [React Architecture Best Practices — Simform](https://www.simform.com/blog/react-architecture-best-practices/)
- [33 React JS Best Practices For 2026 — Technostacks](https://technostacks.com/blog/react-best-practices/)
