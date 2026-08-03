---
name: onion-architecture
description: Forces onion/hexagonal layering for the DevDigest backend (server/, reviewer-core/) — domain has zero I/O, services depend only on ports/interfaces resolved through the DI container (server/src/platform/container.ts), concrete adapters live at the edge under adapters/<kind>/, and routes only translate HTTP <-> service calls. Use this whenever adding or reviewing code in server/src/modules/**, server/src/adapters/**, server/src/platform/container.ts, or reviewer-core/src/**; whenever wiring a new external integration (LLM provider, GitHub, git, Slack, webhook, feature-flag source, anything outside-the-process); or whenever the question is "where should this code/logic live" for a backend feature — even if the user never says "onion" or "hexagonal". Also trigger when you notice a route file importing an adapter directly, a service importing a concrete adapter class instead of a container-resolved interface, or reviewer-core growing a DB/fs/network dependency.
---

# Onion Architecture (Backend)

## Language

Answer in Ukrainian — that's the language this team works in (see the root
`CLAUDE.md` and `engineering-insights` skill, which apply the same rule to
`INSIGHTS.md` entries). Keep identifiers, file paths, and code samples
exactly as they are in the codebase (`routes.ts`, `container.github()`,
`OctokitGitHubClient`, …) — only the surrounding explanation is Ukrainian.

## Why this exists

`server/` and `reviewer-core/` are already built this way — the DI container
(`server/src/platform/container.ts`) exists specifically so adapters can be
swapped for mocks in tests, and `reviewer-core` is deliberately DB/fs-free so
it stays hermetically testable. That property degrades one shortcut at a
time: one route that imports an adapter directly, one service that
`new`s a concrete class instead of asking the container. None of those
shortcuts break anything the day they're written — they break the next
person's ability to test in isolation or swap an integration without a
rewrite. This skill exists to stop that erosion at review time, not to
introduce a new pattern.

## The rule

Dependencies point inward, one direction only. A layer knows about the layer
below it through an interface; it never imports a concrete implementation
from a layer further out.

```
routes.ts  --calls-->  service.ts  --depends on ports-->  adapters/<kind>/*.ts
   |                        |                                      ^
   |                        v                                      |
   |                  repository.ts --(Drizzle)--> db                |
   |                                                                 |
   +----------------------- never -------------------------------->-+
```

| Layer | Lives at | Depends on | Never depends on |
|---|---|---|---|
| Domain (pure logic) | `reviewer-core/src/**` | nothing external; only an injected `LLMProvider` | DB, fs, network, `server/**` |
| Service (orchestration) | `modules/<name>/service.ts`, `run-executor.ts` | port/interface types resolved via `Container` | concrete adapter classes, `adapters/**` imports |
| Repository (data access) | `modules/<name>/repository.ts` | Drizzle, `db/client` | HTTP concerns |
| Ports (interfaces) | `vendor/shared` (`@devdigest/shared`) | nothing | any concrete adapter |
| Adapters (port implementations) | `adapters/<kind>/*.ts` | the external SDK/API they wrap | other adapters, services |
| Composition root | `platform/container.ts` | everything (lazily) — this is the **one** place concrete adapters get imported and wired | — |
| HTTP translation | `modules/<name>/routes.ts` | `service.ts` only | `adapters/**`, `db/client` |

`container.ts` is not a violation of the rule — it's the deliberate exception
the rule needs. Everywhere else, "point inward" is absolute.

## Red flags — what to catch

**1. A route importing an adapter or the DB client directly.**

```ts
// modules/pulls/routes.ts — BAD
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
app.get('/pulls/:id', async (req, reply) => {
  const client = new OctokitGitHubClient(...);   // routes never construct adapters
  ...
});
```
Fix: route calls `service.something(...)`; the service already holds the
adapter via `this.container`.

**2. A service importing a concrete adapter class instead of a port type.**

```ts
// service.ts — BAD
import { SimpleGitClient } from '../../adapters/git/simple-git.js';
constructor(private container: Container) {
  this.git = new SimpleGitClient();   // bypasses the container entirely
}
```
Fix: `this.git = container.git;` (or whatever the container's lazy getter is
named) — the concrete class is only ever named inside `container.ts`.

**3. A new external integration added without the full chain.** Adding
"just the adapter" and importing it straight into a service produces
something that works today and can't be mocked tomorrow. See the workflow
below — a new integration is never one file.

**4. `reviewer-core` acquiring I/O.** Anything under `reviewer-core/src/**`
importing `fs`, a DB client, or making a network call *outside* the injected
`LLMProvider` breaks the "diff in, grounded findings out, no side effects"
contract the whole package is built on (see `reviewer-core/README.md`).

**5. Data-access logic leaking into `service.ts`.** Raw Drizzle queries
belong in `repository.ts`; a service method that builds its own `db.select()`
is skipping a layer, not simplifying anything.

None of these are hard failures to flag reflexively — a two-line script or a
one-off migration doesn't need this ceremony. The rule matters once code
takes a dependency that a future test or a future swap-out will need to
intercept.

## Workflow: adding a new external integration

Whether it's a new LLM provider, a Slack notifier, a webhook receiver, or a
feature-flag source — the shape is always the same five steps:

1. **Define the port.** An interface in `@devdigest/shared` (if other
   packages need the type) or a local `types.ts` (if it's module-private).
   Name it for the capability, not the vendor (`Notifier`, not
   `SlackClient`).
2. **Implement the adapter.** `adapters/<kind>/<vendor>.ts`, implementing
   the port. This is the only file allowed to import the vendor SDK.
3. **Add a mock.** `adapters/mocks.ts` (or a module-local mock) implementing
   the same port, so tests never hit the real network. Look at
   `MockLLMProvider` / `MockGitClient` for the pattern already in use.
4. **Wire it into `Container`.** A private field + lazy getter, same shape
   as `_git` / `_github` in `platform/container.ts`. Tests inject the mock
   through `ContainerOverrides`.
5. **Consume the port, not the class.** The service takes the interface type
   from the container; it never imports step 2's file.

Skipping straight to step 2 and importing it from a service is the most
common shortcut — it works immediately and quietly removes the ability to
test that code path without a live network call.

## Workflow: "where does this code go?"

When the question is placement rather than a new integration, resolve it by
what the code *does*, not where it's convenient to type it:

- Talks HTTP (headers, status codes, request parsing) → `routes.ts`
- Orchestrates a multi-step operation, decides business outcomes → `service.ts`
- Reads/writes Postgres via Drizzle → `repository.ts`
- Wraps a specific external system (git, GitHub, an LLM, secrets) → `adapters/<kind>/`
- Pure transformation with no I/O, reusable across the reviewer pipeline → `reviewer-core/src/**`

If a change genuinely spans two of these, that's normal — a feature usually
touches route + service + repository together. The violation is a *layer
being skipped*, not a feature touching multiple layers.

## Exemplars already in this codebase

Point to these instead of re-explaining the pattern in the abstract:

- `server/src/platform/container.ts` — the composition root; lazy getters
  (`_git`, `_github`, …) are the reference shape for wiring any new adapter.
- `server/src/modules/reviews/service.ts` + `run-executor.ts` — a service
  that depends on `Container`, never on concrete adapter classes.
- `reviewer-core/src/**` — the reference pure-domain package: diff → prompt →
  LLM (injected) → grounding, zero ambient I/O, fully mock-testable via a
  stubbed `LLMProvider`.
- `server/src/adapters/mocks.ts` — the existing mock adapters tests inject
  through `ContainerOverrides`.

## Out of scope

- `client/**` — frontend placement questions belong to the
  `react-ui-architecture` skill instead.
- `e2e/**` — hermetic spec runner, not part of this layering.
- Pure SQL migrations, config-only changes, or a fix contained entirely
  within one existing layer — don't invoke this ceremony for those.

## Quick checklist

- [ ] Does `routes.ts` call only `service.ts`?
- [ ] Does `service.ts` reference the port type, resolved via `container`,
      never a concrete `adapters/**` class?
- [ ] Is Drizzle access confined to `repository.ts`?
- [ ] New external dependency → port + adapter + mock + container wiring, all
      four, not just the adapter?
- [ ] Still true that `reviewer-core/src/**` has no DB/fs/network beyond the
      injected `LLMProvider`?
