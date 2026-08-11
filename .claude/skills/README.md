# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend † | Onion/hexagonal layering for server/reviewer-core — domain has zero I/O, services depend only on DI-resolved ports, adapters live at the edge |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [react-ui-architecture](react-ui-architecture/SKILL.md) | Frontend † | Decision framework for where a component/hook/util physically belongs — feature-local vs. shared, when to promote |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Workflow † | Capture session findings into each module's `INSIGHTS.md`, with `file:line` evidence |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow † | Second-pass review of the uncommitted diff before a PR is opened — routes frontend/backend surfaces to this catalog's own skills, blocks on critical findings |
| [sdd-implement](sdd-implement/SKILL.md) | Workflow † | Executes an approved Development Plan through `implementer` → a `plan-verifier`/`architecture-reviewer` fix-loop (capped, auto-escalates) → optional `doc-writer`. Does not write specs or plans — `spec-creator`/`implementation-planner` stay manual. |
| [workflow-retro](workflow-retro/SKILL.md) | Workflow † | **Manual trigger only.** Post-run retrospective: tokens, cache reads, tool calls, duration, parallelism — including nested subagents, whose spend under-reports by 4x–56x in the parent summary. Ships `collect.sh`; appends a trend row to `docs/retros/ledger.md`. |

† **Locally authored.** Every other skill in this catalog is vendored from GitHub
and tracked in [`skills-lock.json`](../../skills-lock.json) with a source and a
content hash. These six have no upstream, so they are deliberately absent
from that lockfile — adding them with a synthetic source would break the
integrity check. Four of them (`engineering-insights`, `pr-self-review`,
`sdd-implement`, `workflow-retro`) are *workflow* skills; `onion-architecture`
and `react-ui-architecture` are locally authored domain knowledge, same category
as the vendored Backend/Frontend skills around them — "locally authored" and
"workflow" are independent facts about a skill, not the same thing.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
