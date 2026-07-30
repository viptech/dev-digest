# client/CLAUDE.md

Package-local conventions for `@devdigest/web`. Read `client/README.md` first
for the route map and data-hook pattern — this file only holds what isn't
there.

## Conventions

**Feature-folder shape:** pages (`src/app/**/page.tsx`) stay thin; feature
logic sits in colocated `_components/<Name>/` folders containing `<Name>.tsx`,
`index.ts`, and — as needed — `styles.ts`, `helpers.ts`, `constants.ts`,
`<Name>.test.tsx`. Data hooks live in `src/lib/hooks/*` over `src/lib/api.ts`.
