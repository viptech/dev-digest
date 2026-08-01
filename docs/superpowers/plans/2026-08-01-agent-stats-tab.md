# Agent Stats Tab — Implementation Plan (Plan D of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stats" tab to the Agent Editor showing per-agent quality/cost
aggregates over the last 30 days: run count, avg cost, avg latency, accept
rate, findings-by-severity, most-used skills, findings-by-category, and a
recent run history table linking into the existing trace drawer.

**Architecture:** `GET /agents/:id/stats` on the existing `agents` module,
backed by a NEW `StatsRepository` that reads `agent_runs` + `reviews` +
`findings` for the window and aggregates in JS (dataset sizes for a
local-first tool are small — no need for SQL `GROUP BY` gymnastics). The
response shape is the `AgentStats` contract that **already exists**
(`server/src/vendor/shared/contracts/observability.ts`, pre-built for the
later multi-agent/L07 lesson) — this plan EXTENDS it with three fields the
existing shape doesn't cover (`most_used_skills`, `findings_by_category`,
`run_history`) rather than inventing a parallel type. Client renders it with
the already-existing chart primitives (`MetricCard`, `BarRow`, `Donut`,
`LineChart` in `client/src/vendor/ui/charts/`).

**Tech Stack:** Fastify + zod, Drizzle/Postgres, Next.js 15 + React Query,
Recharts (via the existing chart components), next-intl.

## Global Constraints

(Same as Plan A's Global Constraints section — apply unchanged.)

- **Depends on Plan A**: needs `agent_runs.skill_ids` (for "most-used
  skills") and the Skills tab pattern — branch from Plan A's commits. Does
  NOT depend on Plan B or C.
- `AgentStats` already exists as a Zod contract in BOTH `vendor/shared`
  copies, identically (confirmed by diff during design research) — any field
  added to one copy must be added to the other, verbatim
  (`INSIGHTS.md` 2026-07-31 gotcha).
- Donut "findings by category" shows COUNTS, not dollar amounts (the Donut
  component's `valuePrefix` defaults to `"$"` — pass `valuePrefix=""`)  —
  deliberate deviation from the reference mockup, documented in the design
  spec: attributing a run's cost to individual findings by category would be
  an arbitrary allocation.
- "Most-pulled memory" from the reference mockup is explicitly OUT of scope
  — the Memory feature doesn't exist yet in this codebase.

---

## File Structure

**Server:**
- `server/src/vendor/shared/contracts/observability.ts` — extend
  `AgentStats` with `most_used_skills`, `findings_by_category`,
  `run_history` (modify).
- `client/src/vendor/shared/contracts/observability.ts` — same extension,
  mirrored exactly (modify).
- `server/src/modules/agents/stats-repository.ts` — new, reads
  `agent_runs`/`reviews`/`findings`/`skills` for the window.
- `server/src/modules/agents/stats-helpers.ts` — pure aggregation over the
  fetched rows (unit-testable in isolation from the DB).
- `server/src/modules/agents/service.ts` — add `getStats(workspaceId,
  agentId)` (modify).
- `server/src/modules/agents/routes.ts` — add `GET /agents/:id/stats`
  (modify).
- `server/test/agent-stats-helpers.test.ts` — aggregation unit tests.
- `server/test/agent-stats.it.test.ts` — integration test.

**Client:**
- `client/src/lib/hooks/agents.ts` — add `useAgentStats(agentId)` (modify).
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — add
  `stats` tab (modify).
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` —
  render `StatsTab` (modify).
- `client/src/app/agents/[id]/page.tsx` — extend `VALID_TABS` (modify).
- `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/{StatsTab.tsx,styles.ts,index.ts,StatsTab.test.tsx}`

---

## Task 1: Extend the `AgentStats` contract (both copies)

**Files:**
- Modify: `server/src/vendor/shared/contracts/observability.ts`
- Modify: `client/src/vendor/shared/contracts/observability.ts`

**Interfaces:**
- Produces: `AgentStats` gains
  `most_used_skills: { skill_id: string; name: string; pct: number }[]`,
  `findings_by_category: { category: string; count: number }[]`,
  `run_history: { run_id: string; ran_at: string; pr_number: number | null; tokens_in: number; tokens_out: number; cost_usd: number | null; findings_count: number; source: 'local' | 'ci' }[]`.

- [ ] **Step 1: Server copy**

In `server/src/vendor/shared/contracts/observability.ts`, change:
```ts
export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;
```
to (add three fields before the closing `})`):
```ts
export const AgentStatsSkillUsage = z.object({
  skill_id: z.string(),
  name: z.string(),
  /** Fraction (0..1) of this window's runs that had this skill enabled+linked. */
  pct: z.number().min(0).max(1),
});
export type AgentStatsSkillUsage = z.infer<typeof AgentStatsSkillUsage>;

export const AgentStatsCategoryCount = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type AgentStatsCategoryCount = z.infer<typeof AgentStatsCategoryCount>;

export const AgentStatsRunRow = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  pr_number: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  source: z.enum(['local', 'ci']),
});
export type AgentStatsRunRow = z.infer<typeof AgentStatsRunRow>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  trend: z.array(StatPoint),
  most_used_skills: z.array(AgentStatsSkillUsage),
  findings_by_category: z.array(AgentStatsCategoryCount),
  run_history: z.array(AgentStatsRunRow),
});
export type AgentStats = z.infer<typeof AgentStats>;
```

- [ ] **Step 2: Client copy — identical edit**

Apply the EXACT same change to
`client/src/vendor/shared/contracts/observability.ts`. Diff the two files
after editing to confirm they're still byte-identical:
```bash
diff server/src/vendor/shared/contracts/observability.ts \
     client/src/vendor/shared/contracts/observability.ts && echo "identical"
```
Expected: `identical`.

- [ ] **Step 3: Typecheck both packages**

```bash
cd server && node_modules/.bin/tsc --noEmit
cd ../client && node_modules/.bin/tsc --noEmit
```
Expected: no errors (nothing consumes the new fields yet, so this only
validates the Zod schema itself compiles).

- [ ] **Step 4: Commit**

```bash
git add server/src/vendor/shared/contracts/observability.ts \
       client/src/vendor/shared/contracts/observability.ts
git commit -m "feat(contracts): extend AgentStats with skills/category/run-history"
```

---

## Task 2: Stats aggregation helpers (pure, unit-tested)

**Files:**
- Create: `server/src/modules/agents/stats-helpers.ts`
- Test: `server/test/agent-stats-helpers.test.ts`

**Interfaces:**
- Produces: `computeAgentStats(input: StatsInput): AgentStats` where
  `StatsInput` bundles the raw rows the repository will fetch:
  ```ts
  interface StatsInput {
    agentId: string;
    agentName: string;
    runs: { id: string; ranAt: Date; durationMs: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null; findingsCount: number | null; skillIds: string[] | null; prNumber: number | null; source: 'local' | 'ci' }[];
    findings: { severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION'; category: string; acceptedAt: Date | null; dismissedAt: Date | null }[];
    skillNames: Map<string, string>; // skillId -> name, for the runs' skillIds
  }
  ```
  This separation (pure function over already-fetched rows) is what makes
  the aggregation logic testable without a database.

- [ ] **Step 1: Write the failing tests**

Create `server/test/agent-stats-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeAgentStats } from '../src/modules/agents/stats-helpers.js';

const BASE_RUN = {
  id: 'r1',
  ranAt: new Date('2026-07-01T00:00:00Z'),
  durationMs: 4000,
  tokensIn: 1000,
  tokensOut: 200,
  costUsd: 0.04,
  findingsCount: 2,
  skillIds: ['s1'],
  prNumber: 482,
  source: 'local' as const,
};

describe('computeAgentStats', () => {
  it('returns zeroed/null stats for no runs', () => {
    const stats = computeAgentStats({ agentId: 'a1', agentName: 'Agent', runs: [], findings: [], skillNames: new Map() });
    expect(stats.runs).toBe(0);
    expect(stats.accept_rate).toBeNull();
    expect(stats.avg_cost_usd).toBeNull();
    expect(stats.most_used_skills).toEqual([]);
    expect(stats.run_history).toEqual([]);
  });

  it('computes avg cost/latency and run_history from runs', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN, { ...BASE_RUN, id: 'r2', costUsd: 0.06, durationMs: 6000, skillIds: [] }],
      findings: [],
      skillNames: new Map([['s1', 'Corner Cases']]),
    });
    expect(stats.runs).toBe(2);
    expect(stats.avg_cost_usd).toBeCloseTo(0.05);
    expect(stats.avg_latency_ms).toBe(5000);
    expect(stats.run_history).toHaveLength(2);
    expect(stats.run_history[0]!.pr_number).toBe(482);
  });

  it('computes accept_rate only over findings with a verdict (accepted or dismissed)', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN],
      findings: [
        { severity: 'CRITICAL', category: 'security', acceptedAt: new Date(), dismissedAt: null },
        { severity: 'WARNING', category: 'bug', acceptedAt: null, dismissedAt: new Date() },
        { severity: 'SUGGESTION', category: 'style', acceptedAt: null, dismissedAt: null }, // pending, excluded from the rate
      ],
      skillNames: new Map(),
    });
    expect(stats.accepted).toBe(1);
    expect(stats.dismissed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.accept_rate).toBeCloseTo(0.5); // 1 accepted / (1 accepted + 1 dismissed)
    expect(stats.findings_total).toBe(3);
  });

  it('groups findings_by_severity and findings_by_category', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN],
      findings: [
        { severity: 'CRITICAL', category: 'security', acceptedAt: null, dismissedAt: null },
        { severity: 'CRITICAL', category: 'security', acceptedAt: null, dismissedAt: null },
        { severity: 'WARNING', category: 'perf', acceptedAt: null, dismissedAt: null },
      ],
      skillNames: new Map(),
    });
    expect(stats.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(stats.findings_by_category).toEqual(
      expect.arrayContaining([
        { category: 'security', count: 2 },
        { category: 'perf', count: 1 },
      ]),
    );
  });

  it('computes most_used_skills as the fraction of runs using each skill, sorted descending, top 5', () => {
    const runs = [
      { ...BASE_RUN, id: 'r1', skillIds: ['s1', 's2'] },
      { ...BASE_RUN, id: 'r2', skillIds: ['s1'] },
      { ...BASE_RUN, id: 'r3', skillIds: [] },
      { ...BASE_RUN, id: 'r4', skillIds: null },
    ];
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs,
      findings: [],
      skillNames: new Map([['s1', 'Corner Cases'], ['s2', 'Api Contract']]),
    });
    expect(stats.most_used_skills[0]).toEqual({ skill_id: 's1', name: 'Corner Cases', pct: 0.5 });
    expect(stats.most_used_skills[1]).toEqual({ skill_id: 's2', name: 'Api Contract', pct: 0.25 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && node_modules/.bin/vitest run test/agent-stats-helpers.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `stats-helpers.ts`**

Create `server/src/modules/agents/stats-helpers.ts`:
```ts
import type { AgentStats } from '@devdigest/shared';

export interface StatsRun {
  id: string;
  ranAt: Date;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  findingsCount: number | null;
  skillIds: string[] | null;
  prNumber: number | null;
  source: 'local' | 'ci';
}

export interface StatsFinding {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

export interface StatsInput {
  agentId: string;
  agentName: string;
  runs: StatsRun[];
  findings: StatsFinding[];
  skillNames: Map<string, string>;
}

const MAX_MOST_USED_SKILLS = 5;
const MAX_RUN_HISTORY = 10;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pure aggregation over already-fetched rows — no DB access, fully unit-testable. */
export function computeAgentStats(input: StatsInput): AgentStats {
  const { runs, findings, skillNames } = input;

  const costs = runs.map((r) => r.costUsd).filter((v): v is number => v != null);
  const durations = runs.map((r) => r.durationMs).filter((v): v is number => v != null);
  const findingCounts = runs.map((r) => r.findingsCount).filter((v): v is number => v != null);

  const accepted = findings.filter((f) => f.acceptedAt != null).length;
  const dismissed = findings.filter((f) => f.dismissedAt != null).length;
  const pending = findings.length - accepted - dismissed;
  const acted = accepted + dismissed;

  const bySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  const byCategory = new Map<string, number>();
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }

  const skillRunCounts = new Map<string, number>();
  for (const r of runs) {
    for (const id of r.skillIds ?? []) {
      skillRunCounts.set(id, (skillRunCounts.get(id) ?? 0) + 1);
    }
  }
  const mostUsedSkills = [...skillRunCounts.entries()]
    .map(([skillId, count]) => ({
      skill_id: skillId,
      name: skillNames.get(skillId) ?? skillId,
      pct: runs.length === 0 ? 0 : count / runs.length,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_MOST_USED_SKILLS);

  const runHistory = [...runs]
    .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
    .slice(0, MAX_RUN_HISTORY)
    .map((r) => ({
      run_id: r.id,
      ran_at: r.ranAt.toISOString(),
      pr_number: r.prNumber,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
      cost_usd: r.costUsd,
      findings_count: r.findingsCount,
      source: r.source,
    }));

  return {
    agent_id: input.agentId,
    agent_name: input.agentName,
    runs: runs.length,
    findings_total: findings.length,
    accepted,
    dismissed,
    pending,
    accept_rate: acted === 0 ? null : accepted / acted,
    dismiss_rate: acted === 0 ? null : dismissed / acted,
    avg_findings_per_run: avg(findingCounts),
    total_cost_usd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
    avg_cost_usd: avg(costs),
    avg_latency_ms: avg(durations),
    findings_by_severity: bySeverity,
    trend: [...runs]
      .sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime())
      .map((r) => ({ label: r.ranAt.toISOString().slice(0, 10), value: r.costUsd ?? 0 })),
    most_used_skills: mostUsedSkills,
    findings_by_category: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    run_history: runHistory,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && node_modules/.bin/vitest run test/agent-stats-helpers.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd server && node_modules/.bin/tsc --noEmit
```
```bash
git add server/src/modules/agents/stats-helpers.ts server/test/agent-stats-helpers.test.ts
git commit -m "feat(agents): add pure AgentStats aggregation"
```

---

## Task 3: `StatsRepository` + wire into `AgentsService`/`routes.ts`

**Files:**
- Create: `server/src/modules/agents/stats-repository.ts`
- Modify: `server/src/modules/agents/service.ts`
- Modify: `server/src/modules/agents/routes.ts`
- Test: `server/test/agent-stats.it.test.ts`

**Interfaces:**
- Consumes: `t.agentRuns`, `t.reviews`, `t.findings`, `t.pullRequests`,
  `t.skills` (`server/src/db/schema.ts`), `computeAgentStats` (Task 2).
- Produces: `class StatsRepository` with `getWindowData(workspaceId, agentId,
  sinceDate): Promise<{ runs: StatsRun[]; findings: StatsFinding[];
  skillNames: Map<string,string> }>`; `AgentsService.getStats(workspaceId,
  agentId): Promise<AgentStats | undefined>`; route `GET
  /agents/:id/stats`.

- [ ] **Step 1: Write the repository**

Create `server/src/modules/agents/stats-repository.ts`:
```ts
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { StatsFinding, StatsRun } from './stats-helpers.js';

const WINDOW_DAYS = 30;

export class StatsRepository {
  constructor(private db: Db) {}

  async getWindowData(
    workspaceId: string,
    agentId: string,
  ): Promise<{ runs: StatsRun[]; findings: StatsFinding[]; skillNames: Map<string, string> }> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const runRows = await this.db
      .select({
        id: t.agentRuns.id,
        ranAt: t.agentRuns.ranAt,
        durationMs: t.agentRuns.durationMs,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
        findingsCount: t.agentRuns.findingsCount,
        skillIds: t.agentRuns.skillIds,
        source: t.agentRuns.source,
        prNumber: t.pullRequests.number,
      })
      .from(t.agentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          gte(t.agentRuns.ranAt, since),
        ),
      );

    const runs: StatsRun[] = runRows.map((r) => ({
      id: r.id,
      ranAt: r.ranAt,
      durationMs: r.durationMs,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: r.costUsd,
      findingsCount: r.findingsCount,
      skillIds: (r.skillIds as string[] | null) ?? null,
      prNumber: r.prNumber ?? null,
      source: (r.source as 'local' | 'ci') ?? 'local',
    }));

    const reviewRows = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.agentId, agentId),
          gte(t.reviews.createdAt, since),
        ),
      );
    const reviewIds = reviewRows.map((r) => r.id);

    const findingRows = reviewIds.length
      ? await this.db
          .select({
            severity: t.findings.severity,
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
            dismissedAt: t.findings.dismissedAt,
          })
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
      : [];
    const findings: StatsFinding[] = findingRows.map((f) => ({
      severity: f.severity as StatsFinding['severity'],
      category: f.category,
      acceptedAt: f.acceptedAt,
      dismissedAt: f.dismissedAt,
    }));

    const skillIds = [...new Set(runs.flatMap((r) => r.skillIds ?? []))];
    const skillRows = skillIds.length
      ? await this.db.select({ id: t.skills.id, name: t.skills.name }).from(t.skills).where(inArray(t.skills.id, skillIds))
      : [];
    const skillNames = new Map(skillRows.map((s) => [s.id, s.name]));

    return { runs, findings, skillNames };
  }
}
```

- [ ] **Step 2: Wire into `AgentsService`**

In `server/src/modules/agents/service.ts`, add the import and a new method:
```ts
import { StatsRepository } from './stats-repository.js';
import { computeAgentStats } from './stats-helpers.js';
import type { AgentStats } from '@devdigest/shared';
```
Add a `statsRepo` field alongside the existing `repo` field in the
constructor, and a new method:
```ts
  private statsRepo: StatsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
    this.statsRepo = new StatsRepository(container.db);
  }
```
(Merge this into the EXISTING constructor rather than duplicating it — the
class already has `constructor(private container: Container) { this.repo =
new AgentsRepository(container.db); }`; add the `statsRepo` line inside it.)
```ts
  async getStats(workspaceId: string, agentId: string): Promise<AgentStats | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const { runs, findings, skillNames } = await this.statsRepo.getWindowData(workspaceId, agentId);
    return computeAgentStats({ agentId, agentName: agent.name, runs, findings, skillNames });
  }
```

- [ ] **Step 3: Route**

In `server/src/modules/agents/routes.ts`, add after the `/agents/:id/models`
route:
```ts
  app.get('/agents/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.getStats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Agent not found');
    return stats;
  });
```
Also add this line to the route-map docstring comment at the top of the file
(`GET /agents/:id/stats → 30-day quality/cost aggregates`).

- [ ] **Step 4: Integration test**

Create `server/test/agent-stats.it.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 's',
  score: 50,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r',
      confidence: 0.9,
    },
  ],
};

d('agent stats (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('aggregates runs + findings for the agent over the window', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW }) },
      },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Stats Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'stats-repo', fullName: 'acme/stats-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'x',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.runs).toBe(1);
    expect(stats.findings_total).toBe(1);
    expect(stats.findings_by_severity.CRITICAL).toBe(1);
    expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
    expect(stats.run_history).toHaveLength(1);
    expect(stats.run_history[0].pr_number).toBe(7);
    expect(stats.accept_rate).toBeNull(); // finding not yet accepted/dismissed

    await app.close();
  });

  it('404s for an unknown agent', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), embedder: new MockEmbedder() },
    });
    const res = await app.inject({ method: 'GET', url: `/agents/00000000-0000-0000-0000-000000000000/stats` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 5: Run it**

```bash
cd server && node_modules/.bin/vitest run test/agent-stats.it.test.ts
```
Expected: PASS if Docker is available; SKIP otherwise.

- [ ] **Step 6: Full server suite**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/agents/stats-repository.ts server/src/modules/agents/service.ts \
       server/src/modules/agents/routes.ts server/test/agent-stats.it.test.ts
git commit -m "feat(agents): add GET /agents/:id/stats"
```

---

## Task 4: Client hook + `StatsTab`

**Files:**
- Modify: `client/src/lib/hooks/agents.ts`
- Create: `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/{StatsTab.tsx,styles.ts,index.ts,StatsTab.test.tsx}`
- Modify: `AgentEditor/constants.ts`, `AgentEditor.tsx`, `[id]/page.tsx`

**Interfaces:**
- Consumes: `AgentStats` (`@devdigest/shared`), `MetricCard`, `BarRow`,
  `Donut`, `LineChart` (`@devdigest/ui` → `client/src/vendor/ui/charts`).
- Produces: `useAgentStats(agentId)`; `StatsTab({ agentId })`.

- [ ] **Step 1: Hook**

In `client/src/lib/hooks/agents.ts`, add:
```ts
import type { AgentStats } from "@devdigest/shared";

export function useAgentStats(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-stats", agentId],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats`),
    enabled: !!agentId,
  });
}
```

- [ ] **Step 2: `StatsTab`**

Create `.../StatsTab/styles.ts`:
```ts
export const s = {
  wrap: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 } as React.CSSProperties,
  tiles: { display: "flex", gap: 14 } as React.CSSProperties,
  panels: { display: "flex", gap: 20, flexWrap: "wrap" } as React.CSSProperties,
  panel: {
    flex: "1 1 320px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
  } as React.CSSProperties,
  panelTitle: { fontSize: 13, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 } as React.CSSProperties,
  th: { textAlign: "left", color: "var(--text-muted)", padding: "6px 8px", borderBottom: "1px solid var(--border)" } as React.CSSProperties,
  td: { padding: "6px 8px", borderBottom: "1px solid var(--border)" } as React.CSSProperties,
};
```

Create `.../StatsTab/StatsTab.tsx`:
```tsx
"use client";

import React from "react";
import { MetricCard, BarRow, Donut, Icon, Badge } from "@devdigest/ui";
import { useAgentStats } from "../../../../../../lib/hooks/agents";
import { s } from "./styles";

// This tab uses literal English labels throughout rather than i18n keys —
// none of the headline-tile/panel copy exists yet in agents.json, and
// inventing a parallel ad-hoc namespace for a handful of labels isn't
// worth it; add proper i18n keys in a follow-up pass if this ships broadly.
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

export function StatsTab({ agentId }: { agentId: string }) {
  const { data: stats, isLoading } = useAgentStats(agentId);

  if (isLoading || !stats) {
    return <div style={s.wrap}>Loading stats…</div>;
  }

  const maxSkillPct = Math.max(...stats.most_used_skills.map((s2) => s2.pct), 0.01);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label="TOTAL RUNS (30D)" value={stats.runs} />
        <MetricCard
          label="AVG COST / RUN"
          value={stats.avg_cost_usd != null ? `$${stats.avg_cost_usd.toFixed(2)}` : "—"}
        />
        <MetricCard
          label="AVG DURATION"
          value={stats.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
        />
        <MetricCard
          label="ACCEPT RATE"
          value={stats.accept_rate != null ? `${Math.round(stats.accept_rate * 100)}%` : "—"}
        />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Sparkles size={14} /> Most-used skills
          </div>
          {stats.most_used_skills.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No skills used in this window.</p>}
          {stats.most_used_skills.map((skill) => (
            <BarRow
              key={skill.skill_id}
              label={skill.name}
              value={skill.pct}
              max={maxSkillPct}
              suffix={`${Math.round(skill.pct * 100)}%`}
            />
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.AlertTriangle size={14} /> Findings by severity
          </div>
          {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => (
            <BarRow
              key={sev}
              label={sev}
              value={stats.findings_by_severity[sev]}
              max={Math.max(stats.findings_by_severity.CRITICAL, stats.findings_by_severity.WARNING, stats.findings_by_severity.SUGGESTION, 1)}
              color={SEVERITY_COLOR[sev]}
              suffix={String(stats.findings_by_severity[sev])}
            />
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Boxes size={14} /> Findings by category
          </div>
          {stats.findings_by_category.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No findings in this window.</p>
          ) : (
            <Donut
              valuePrefix=""
              segments={stats.findings_by_category.map((c, i) => ({
                label: c.category,
                value: c.count,
                color: ["var(--crit)", "var(--warn)", "var(--accent)", "var(--ok)", "var(--text-muted)"][i % 5]!,
              }))}
            />
          )}
        </div>
      </div>

      <div style={s.panel}>
        <div style={s.panelTitle}>
          <Icon.History size={14} /> Run history
        </div>
        {stats.run_history.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No runs yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Timestamp</th>
                <th style={s.th}>PR</th>
                <th style={s.th}>Tokens</th>
                <th style={s.th}>Cost</th>
                <th style={s.th}>Findings</th>
                <th style={s.th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {stats.run_history.map((r) => (
                <tr key={r.run_id}>
                  <td style={s.td}>{new Date(r.ran_at).toLocaleString()}</td>
                  <td style={s.td}>{r.pr_number != null ? `#${r.pr_number}` : "—"}</td>
                  <td style={s.td}>{(r.tokens_in ?? 0) + (r.tokens_out ?? 0)}</td>
                  <td style={s.td}>{r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "—"}</td>
                  <td style={s.td}>{r.findings_count ?? 0}</td>
                  <td style={s.td}>
                    <Badge color="var(--text-muted)">{r.source}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

(The loading-state string is a literal, not an i18n key — consistent with
other literal UI strings already used elsewhere in this plan and Plan A,
e.g. `SkillDrawer`'s "Cancel" button; a dedicated i18n key can be added
later.)

Create `.../StatsTab/index.ts`: `export { StatsTab } from "./StatsTab";`

- [ ] **Step 3: Test**

Create `.../StatsTab/StatsTab.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsTab } from "./StatsTab";
import type { AgentStats } from "@devdigest/shared";

const STATS: AgentStats = {
  agent_id: "a1",
  agent_name: "Agent",
  runs: 5,
  findings_total: 3,
  accepted: 2,
  dismissed: 1,
  pending: 0,
  accept_rate: 0.667,
  dismiss_rate: 0.333,
  avg_findings_per_run: 0.6,
  total_cost_usd: 0.2,
  avg_cost_usd: 0.04,
  avg_latency_ms: 6200,
  findings_by_severity: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
  trend: [],
  most_used_skills: [{ skill_id: "s1", name: "Corner Cases", pct: 0.8 }],
  findings_by_category: [{ category: "security", count: 1 }, { category: "bug", count: 2 }],
  run_history: [
    { run_id: "r1", ran_at: "2026-07-01T00:00:00Z", pr_number: 482, tokens_in: 1000, tokens_out: 200, cost_usd: 0.04, findings_count: 3, source: "local" },
  ],
};

vi.mock("../../../../../../lib/hooks/agents", () => ({
  useAgentStats: () => ({ data: STATS, isLoading: false }),
}));

describe("StatsTab", () => {
  it("renders the 4 headline tiles", () => {
    render(<StatsTab agentId="a1" />);
    expect(screen.getByText("5")).toBeInTheDocument(); // total runs
    expect(screen.getByText("$0.04")).toBeInTheDocument();
    expect(screen.getByText("6.2s")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("renders most-used skills and run history", () => {
    render(<StatsTab agentId="a1" />);
    expect(screen.getByText("Corner Cases")).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it**

```bash
cd client && node_modules/.bin/vitest run src/app/agents/\[id\]/_components/AgentEditor/_components/StatsTab
```
Expected: PASS.

- [ ] **Step 5: Wire into `AgentEditor`**

In `AgentEditor/constants.ts`, add `{ key: "stats", labelKey:
"editor.tabs.stats", icon: "BarChart" }` to `TABS` (after `evals` if Plan C
already ran, otherwise after `skills`).

In `AgentEditor.tsx`, extend the tab switch with a `stats` branch (same
nested-ternary or switch style already used):
```tsx
        {tab === "skills" ? (
          <SkillsTab agentId={agent.id} />
        ) : tab === "evals" ? (
          <EvalsTab agentId={agent.id} />
        ) : tab === "stats" ? (
          <StatsTab agentId={agent.id} />
        ) : (
          <ConfigTab agent={agent} />
        )}
```
(Omit the `evals` branch if Plan C hasn't been applied to this working tree
yet — match whatever tab branches already exist in the file at the time this
task runs.)

In `[id]/page.tsx`, add `"stats"` to `VALID_TABS`.

- [ ] **Step 6: Full client check**

```bash
cd client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/app/agents
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/hooks/agents.ts \
       client/src/app/agents/\[id\]/_components/AgentEditor \
       client/src/app/agents/\[id\]/page.tsx
git commit -m "feat(agents): add Stats tab"
```

---

## Final Task: Verification

- [ ] **Step 1: Full-repo checks**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
cd ../client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

- [ ] **Step 2: Manual pass**

Run a few reviews with the Test Quality Reviewer agent (with its skill
enabled and disabled, a few times each), then open `/agents/<id>?tab=stats`
and confirm: run count matches, most-used skills shows the skill at roughly
the expected %, findings-by-severity/category reflect what was actually
found, run history lists the runs with working PR numbers.

- [ ] **Step 3: Insight capture**

Invoke `engineering-insights` for anything non-obvious (e.g. actual
`Icon`/`Badge`/chart-component prop mismatches found while wiring `StatsTab`).
