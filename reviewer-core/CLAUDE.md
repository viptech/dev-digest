# reviewer-core/CLAUDE.md

Package-local notes for `@devdigest/reviewer-core`. Read `reviewer-core/README.md`
first for the pipeline diagram — this file only holds what isn't there. Root
`CLAUDE.md` has the do-not-touch entries for the grounding gate and the
injection guard, both owned by this package.

## Gotcha

**`npm run build` never emits JS** — it's an alias for `tsc --noEmit`
(typecheck only). The server consumes this package's TypeScript *source*
directly via a tsconfig path alias, never a built `dist/`.
