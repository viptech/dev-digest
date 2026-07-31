# Severity Badge Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover tooltip listing individual findings to the two severity-badge locations that currently only show aggregate counts (Run History timeline rows, and a new FINDINGS column on the Pull Requests list), while leaving the Findings panel's click-to-filter chips untouched.

**Architecture:** One new shared `FindingsTooltip` component (hover-controlled, absolutely positioned card) wraps the existing severity badges in `RunHistory` (data already in memory) and a new severity-badge column added to `PRRow` (data added via a `findings_summary` field on the `PrMeta` contract, aggregated server-side from each PR's latest review).

**Tech Stack:** Next.js/React client (`client/`, pnpm, Vitest + RTL), Fastify/Drizzle server (`server/`, pnpm, Vitest), Zod contracts in `server/src/vendor/shared/contracts/`.

## Global Constraints

- Wire contracts are `snake_case` (`server/CLAUDE.md`, root `CLAUDE.md`) — the new `findings_summary` field and its nested fields follow this.
- `server/` uses pnpm as canonical; `client/` uses pnpm. Do not touch lockfiles.
- DB module shape: `modules/<name>/routes.ts` + `service.ts` + `repository.ts` (root `server/CLAUDE.md`). No new migration is needed — this only reads existing `findings`/`reviews` tables.
- Client feature-folder shape: colocated `_components/<Name>/` with `<Name>.tsx` + `index.ts` (+ `styles.ts`/`helpers.ts`/`constants.ts` as needed) — `client/CLAUDE.md`.
- No new dependency (no Radix Tooltip) — confirmed with the user during design.
- Findings panel (`FindingsPanel.tsx`) is explicitly out of scope — no changes.

---

### Task 1: `FindingsTooltip` shared component

**Files:**
- Create: `client/src/components/findings-tooltip/FindingsTooltip.tsx`
- Create: `client/src/components/findings-tooltip/styles.ts`
- Create: `client/src/components/findings-tooltip/index.ts`
- Test: `client/src/components/findings-tooltip/FindingsTooltip.test.tsx`

**Interfaces:**
- Produces: `FindingsTooltip({ findings, children }: { findings: TooltipFinding[]; children: React.ReactNode })` — a JSX component. `TooltipFinding` is exported from this file as:
  ```ts
  export interface TooltipFinding {
    id: string;
    severity: "CRITICAL" | "WARNING" | "SUGGESTION";
    title: string;
    file: string;
    start_line: number;
    end_line: number;
    confidence: number;
  }
  ```
  Both Task 2 (Run History, using `FindingRecord[]`) and Task 4 (PR list, using the new `FindingsSummary["items"]`) pass arrays that are structurally compatible with `TooltipFinding[]` — no adapter needed since both source types are supersets of these fields.
- Consumes: `Icon`, `SEV`, `MonoLink`, `ConfidenceNum` from `@devdigest/ui` (already used identically in `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:5` and `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:9-19`).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/findings-tooltip/FindingsTooltip.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindingsTooltip, type TooltipFinding } from "./FindingsTooltip";

afterEach(cleanup);

function finding(overrides: Partial<TooltipFinding> = {}): TooltipFinding {
  return {
    id: "f1",
    severity: "WARNING",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    confidence: 0.86,
    ...overrides,
  };
}

describe("FindingsTooltip", () => {
  it("always renders its children", () => {
    render(
      <FindingsTooltip findings={[finding()]}>
        <span>2</span>
      </FindingsTooltip>,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows no card content before hover", () => {
    render(
      <FindingsTooltip findings={[finding()]}>
        <span>2</span>
      </FindingsTooltip>,
    );
    expect(screen.queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
  });

  it("shows each finding's title and file:line on hover, hides again on mouse leave", () => {
    render(
      <FindingsTooltip
        findings={[
          finding({ id: "f1", title: "N+1 query in user list endpoint" }),
          finding({ id: "f2", title: "Extract magic number 3600", file: "src/middleware/ratelimit.ts", start_line: 28, end_line: 28 }),
        ]}
      >
        <span>2</span>
      </FindingsTooltip>,
    );
    const anchor = screen.getByText("2").parentElement!;
    fireEvent.mouseEnter(anchor);
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:28")).toBeInTheDocument();

    fireEvent.mouseLeave(anchor);
    expect(screen.queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
  });

  it("renders only children, no hover affordance, when findings is empty", () => {
    render(
      <FindingsTooltip findings={[]}>
        <span>0</span>
      </FindingsTooltip>,
    );
    const anchor = screen.getByText("0").parentElement!;
    fireEvent.mouseEnter(anchor);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/components/findings-tooltip/FindingsTooltip.test.tsx`
Expected: FAIL — `Cannot find module './FindingsTooltip'`.

- [ ] **Step 3: Write the styles module**

```ts
// client/src/components/findings-tooltip/styles.ts
import type { CSSProperties } from "react";

export const s = {
  anchor: { position: "relative", display: "inline-flex" } satisfies CSSProperties,
  card: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 6,
    zIndex: 50,
    minWidth: 260,
    maxWidth: 360,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 10,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  header: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    paddingBottom: 6,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  itemLast: { display: "flex", flexDirection: "column", gap: 3 } satisfies CSSProperties,
  itemTitleRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  itemTitle: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  itemMeta: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  itemLoc: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
};
```

- [ ] **Step 4: Write the component**

```tsx
// client/src/components/findings-tooltip/FindingsTooltip.tsx
"use client";

import React from "react";
import { Icon, SEV, ConfidenceNum, type Severity } from "@devdigest/ui";
import { s } from "./styles";

export interface TooltipFinding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
}

function locationLabel(f: TooltipFinding): string {
  return f.end_line !== f.start_line ? `${f.file}:${f.start_line}-${f.end_line}` : `${f.file}:${f.start_line}`;
}

export function FindingsTooltip({
  findings,
  children,
}: {
  findings: TooltipFinding[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  if (findings.length === 0) return <>{children}</>;

  return (
    <span style={s.anchor} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <div role="tooltip" style={s.card}>
          <div style={s.header}>
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </div>
          {findings.map((f, i) => {
            const SevIcon = Icon[SEV[f.severity].icon];
            return (
              <div key={f.id} style={i === findings.length - 1 ? s.itemLast : s.item}>
                <div style={s.itemTitleRow}>
                  <SevIcon size={13} style={{ color: SEV[f.severity].c, flexShrink: 0 }} />
                  <span style={s.itemTitle}>{f.title}</span>
                </div>
                <div style={s.itemMeta}>
                  <span className="mono" style={s.itemLoc}>
                    {locationLabel(f)}
                  </span>
                  <ConfidenceNum value={f.confidence} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Write the barrel export**

```ts
// client/src/components/findings-tooltip/index.ts
export { FindingsTooltip, type TooltipFinding } from "./FindingsTooltip";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && pnpm exec vitest run src/components/findings-tooltip/FindingsTooltip.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add client/src/components/findings-tooltip
git commit -m "feat(findings-tooltip): add shared hover tooltip for severity badges"
```

---

### Task 2: Wire the tooltip into Run History

**Files:**
- Modify: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:203-242`
- Test: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx` (extend)

**Interfaces:**
- Consumes: `FindingsTooltip` and `TooltipFinding` from `@/components/findings-tooltip` (Task 1). `FindingRecord` (from `@devdigest/shared`) is a superset of `TooltipFinding` — passing `FindingRecord[]` directly type-checks against `TooltipFinding[]`.
- No new exports — internal to `RunHistory`.

- [ ] **Step 1: Write the failing test**

Add to `RunHistory.test.tsx` (after the existing `describe` block's last test, before the closing `});`):

```tsx
  it("shows a tooltip with that severity's findings on hovering its badge", () => {
    renderRuns(
      [run({ run_id: "run-1", status: "done", findings_count: 2, blockers: 0, score: 64 })],
      [
        review({
          run_id: "run-1",
          findings: [
            finding({ id: "f1", severity: "WARNING", title: "N+1 query in user list endpoint" }),
            finding({ id: "f2", severity: "SUGGESTION", title: "Extract magic number 3600" }),
          ],
        }),
      ],
    );
    const warningBadge = screen.getByTestId("severity-badge-WARNING");
    expect(screen.queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
    fireEvent.mouseEnter(warningBadge);
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Extract magic number 3600")).not.toBeInTheDocument(); // different severity
  });
```

Add `fireEvent` to the existing `import { render, screen, cleanup } from "@testing-library/react";` line, changing it to `import { render, screen, cleanup, fireEvent } from "@testing-library/react";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunHistory/RunHistory.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="severity-badge-WARNING"]`.

- [ ] **Step 3: Wrap each severity badge in `FindingsTooltip`**

In `RunHistory.tsx`, add the import:

```ts
import { FindingsTooltip } from "@/components/findings-tooltip";
```

Replace the per-severity `<span>` block (lines 218-236) with:

```tsx
                        {SEVERITY_DISPLAY_ORDER.map((sev) => {
                          const SevIcon = Icon[SEV[sev].icon];
                          const sevFindings = findings.filter((f) => f.severity === sev);
                          return (
                            <FindingsTooltip key={sev} findings={sevFindings}>
                              <span
                                data-testid={`severity-badge-${sev}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  color: SEV[sev].c,
                                  borderBottom: `1px dotted ${SEV[sev].c}`,
                                  paddingBottom: 2,
                                }}
                              >
                                <SevIcon size={12} />
                                {counts[sev] ?? 0}
                              </span>
                            </FindingsTooltip>
                          );
                        })}
```

(`findings` is already in scope from the enclosing `const findings = findingsByRunId.get(r.run_id);` a few lines above, already checked non-null via the `if (!findings)` early return.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunHistory/RunHistory.test.tsx`
Expected: PASS (all RunHistory tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunHistory
git commit -m "feat(run-history): show findings tooltip on severity badge hover"
```

---

### Task 3: Server — `findings_summary` on `PrMeta`

**Files:**
- Modify: `server/src/vendor/shared/contracts/platform.ts:1-2,157-176`
- Create: `server/src/modules/pulls/findings-summary.ts`
- Create: `server/src/modules/pulls/findings-summary.test.ts`
- Modify: `server/src/modules/pulls/routes.ts:1-2,113-172` (the `GET /repos/:id/pulls` handler)

**Interfaces:**
- Produces (contract): `FindingsSummaryItem`, `FindingsSummary` zod schemas + inferred types exported from `@devdigest/shared`; `PrMeta.findings_summary?: FindingsSummary | null`.
- Produces (pure helper): `buildFindingsSummary(findings: FindingRow[]): FindingsSummary` from `server/src/modules/pulls/findings-summary.ts`, consumed by `routes.ts`.
- Consumes: `FindingRow` type (`typeof t.findings.$inferSelect`, `server/src/db/rows.ts:14`).

- [ ] **Step 1: Extend the contract**

In `server/src/vendor/shared/contracts/platform.ts`, change the top import:

```ts
import { z } from 'zod';
import { Provider } from './knowledge.js';
import { Severity, FindingCategory } from './findings.js';
```

Add, directly above `export const PrMeta = ...` (before line 157):

```ts
// ---- Findings summary (list endpoint's per-PR severity breakdown) ----
export const FindingsSummaryItem = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number().min(0).max(1),
});
export type FindingsSummaryItem = z.infer<typeof FindingsSummaryItem>;

export const FindingsSummary = z.object({
  counts: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  items: z.array(FindingsSummaryItem),
});
export type FindingsSummary = z.infer<typeof FindingsSummary>;
```

Then add one field to `PrMeta` (after `cost_usd`, still inside the same `z.object({...})`):

```ts
  // Sum of cost_usd across all this PR's agent_runs (list endpoint only).
  cost_usd: z.number().nullish(),
  // Latest-review per-severity findings breakdown (list endpoint only; null
  // until reviewed). Powers the FINDINGS column's hover tooltip.
  findings_summary: FindingsSummary.nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;
```

- [ ] **Step 2: Write the failing test for the pure aggregation helper**

```ts
// server/src/modules/pulls/findings-summary.test.ts
import { describe, it, expect } from 'vitest';
import { buildFindingsSummary } from './findings-summary.js';
import type { FindingRow } from '../../db/rows.js';

function row(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f1',
    reviewId: 'r1',
    file: 'src/api/users.ts',
    startLine: 45,
    endLine: 52,
    severity: 'WARNING',
    category: 'perf',
    title: 'N+1 query in user list endpoint',
    rationale: 'The loop calls db.posts.findMany once per user.',
    suggestion: null,
    confidence: 0.86,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

describe('buildFindingsSummary', () => {
  it('counts findings per severity and carries the display fields through', () => {
    const summary = buildFindingsSummary([
      row({ id: 'f1', severity: 'CRITICAL' }),
      row({ id: 'f2', severity: 'WARNING' }),
      row({ id: 'f3', severity: 'WARNING' }),
    ]);
    expect(summary.counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(summary.items).toHaveLength(3);
    expect(summary.items[1]).toEqual({
      id: 'f2',
      severity: 'WARNING',
      category: 'perf',
      title: 'N+1 query in user list endpoint',
      file: 'src/api/users.ts',
      start_line: 45,
      end_line: 52,
      confidence: 0.86,
    });
  });

  it('returns zeroed counts and an empty item list for no findings', () => {
    const summary = buildFindingsSummary([]);
    expect(summary.counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(summary.items).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run src/modules/pulls/findings-summary.test.ts`
Expected: FAIL — `Cannot find module './findings-summary.js'`.

- [ ] **Step 4: Write the pure helper**

```ts
// server/src/modules/pulls/findings-summary.ts
import type { FindingsSummary } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';

/** Aggregate one review's findings into the PR-list FINDINGS column summary. */
export function buildFindingsSummary(findings: FindingRow[]): FindingsSummary {
  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  const items = findings.map((f) => {
    const sev = f.severity as keyof typeof counts;
    counts[sev] = (counts[sev] ?? 0) + 1;
    return {
      id: f.id,
      severity: f.severity as FindingsSummary['items'][number]['severity'],
      category: f.category as FindingsSummary['items'][number]['category'],
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      confidence: f.confidence,
    };
  });
  return { counts, items };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run src/modules/pulls/findings-summary.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire it into the list route**

In `server/src/modules/pulls/routes.ts`, add the import:

```ts
import { buildFindingsSummary } from './findings-summary.js';
```

Replace the existing latest-review block (currently, `routes.ts:139-152` in the excerpt below — match by content, not exact line numbers since earlier edits may have shifted them):

```ts
    // Latest-review SCORE per PR for the list's score ring. Computed on read
    // from reviews (no FK denorm); the list is small, so one IN-query + JS
    // grouping is cheap. (The per-severity FINDINGS breakdown is intentionally
    // not surfaced on the list — findings live on the PR detail page.)
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { score: number | null }>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({ prId: t.reviews.prId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per PR is the latest review.
      for (const rv of reviewRows) {
        if (!latestReviewByPr.has(rv.prId)) latestReviewByPr.set(rv.prId, { score: rv.score });
      }
    }
```

with:

```ts
    // Latest-review SCORE + per-severity FINDINGS breakdown per PR, for the
    // list's score ring and FINDINGS column tooltip. Computed on read from
    // reviews/findings (no FK denorm); the list is small, so a couple of
    // IN-queries + JS grouping is cheap.
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { id: string; score: number | null }>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({ id: t.reviews.id, prId: t.reviews.prId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per PR is the latest review.
      for (const rv of reviewRows) {
        if (!latestReviewByPr.has(rv.prId)) latestReviewByPr.set(rv.prId, { id: rv.id, score: rv.score });
      }
    }

    const findingsByPr = new Map<string, FindingsSummary>();
    const latestReviewIds = [...latestReviewByPr.values()].map((r) => r.id);
    if (latestReviewIds.length > 0) {
      const findingRows = await container.db
        .select()
        .from(t.findings)
        .where(inArray(t.findings.reviewId, latestReviewIds));
      const findingsByReviewId = new Map<string, typeof findingRows>();
      for (const f of findingRows) {
        const list = findingsByReviewId.get(f.reviewId) ?? [];
        list.push(f);
        findingsByReviewId.set(f.reviewId, list);
      }
      for (const [prId, review] of latestReviewByPr) {
        findingsByPr.set(prId, buildFindingsSummary(findingsByReviewId.get(review.id) ?? []));
      }
    }
```

Add `FindingsSummary` to the existing type-only import at the top of the file:

```ts
import type { PrMeta, PrDetail, GitHubClient, PrReviewComment, FindingsSummary } from '@devdigest/shared';
```

Finally, in the `rows.map((r) => {...})` block that builds the response, change:

```ts
        score: review ? review.score : null,
        cost_usd: costByPr.get(r.id) ?? null,
      };
```

to:

```ts
        score: review ? review.score : null,
        cost_usd: costByPr.get(r.id) ?? null,
        findings_summary: findingsByPr.get(r.id) ?? null,
      };
```

- [ ] **Step 7: Typecheck + run the pulls-module unit suite**

Run: `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/pulls`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/vendor/shared/contracts/platform.ts server/src/modules/pulls
git commit -m "feat(pulls-api): add per-PR findings_summary to the list endpoint"
```

---

### Task 4: PR list — FINDINGS column with tooltip

**Files:**
- Modify: `client/src/app/repos/[repoId]/pulls/constants.ts:26-27,42-50`
- Modify: `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`
- Test: `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx` (create if absent, else extend)
- Modify (i18n): `client/messages/en/prReview.json` — add `list.columns.findings` key (mirror existing `list.columns.*` keys)

**Interfaces:**
- Consumes: `PrMeta.findings_summary` (Task 3, re-exported through `client/src/lib/types.ts:24` already, since it re-exports the whole `PrMeta` type from `@devdigest/shared`). Consumes `FindingsTooltip`/`TooltipFinding` (Task 1). `FindingsSummary["items"]` entries are a superset of `TooltipFinding`, so they pass through directly.
- No new exports beyond the modified `COLUMN_KEYS`/`GRID` constants (module-internal to the pulls list page).

- [ ] **Step 1: No header-specific code changes needed**

`client/src/app/repos/[repoId]/pulls/page.tsx:100-103` already renders the header generically from `COLUMN_KEYS`:

```tsx
{COLUMN_KEYS.map((key, i) => (
  <div key={key} style={s.headCell(i === COLUMN_KEYS.length - 1)}>
    {t(`list.columns.${key}`)}
  </div>
))}
```

Adding `"findings"` to `COLUMN_KEYS` (Step 4 below) is picked up automatically — no edits to `page.tsx` are required.

- [ ] **Step 2: Write the failing test**

```tsx
// client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: 61,
    cost_usd: 0.014,
    findings_summary: null,
    ...overrides,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings column", () => {
  it("renders zeroed severity badges when the PR has never been reviewed", () => {
    renderRow(pr({ findings_summary: null }));
    expect(screen.getAllByText("0")).toHaveLength(3);
  });

  it("renders the latest review's severity counts and a hover tooltip per severity", () => {
    renderRow(
      pr({
        findings_summary: {
          counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 1 },
          items: [
            {
              id: "f1",
              severity: "WARNING",
              category: "perf",
              title: "N+1 query in user list endpoint",
              file: "src/api/users.ts",
              start_line: 45,
              end_line: 52,
              confidence: 0.86,
            },
            {
              id: "f2",
              severity: "SUGGESTION",
              category: "style",
              title: "Extract magic number 3600",
              file: "src/middleware/ratelimit.ts",
              start_line: 28,
              end_line: 28,
              confidence: 0.62,
            },
          ],
        },
      }),
    );
    expect(screen.getByTestId("pr-findings-badge-CRITICAL")).toHaveTextContent("0");
    expect(screen.getByTestId("pr-findings-badge-WARNING")).toHaveTextContent("1");
    expect(screen.getByTestId("pr-findings-badge-SUGGESTION")).toHaveTextContent("1");

    fireEvent.mouseEnter(screen.getByTestId("pr-findings-badge-WARNING"));
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/_components/PRRow/PRRow.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="pr-findings-badge-CRITICAL"]`.

- [ ] **Step 4: Add the column + i18n key**

In `client/src/app/repos/[repoId]/pulls/constants.ts`, change:

```ts
/** Grid template for both the header row and PR rows. */
export const GRID = "1fr 132px 92px 60px 118px 78px 78px";
```

to (one extra column, ~110px, inserted after `score` and before `status` to match the reference layout):

```ts
/** Grid template for both the header row and PR rows. */
export const GRID = "1fr 132px 92px 60px 110px 118px 78px 78px";
```

And change:

```ts
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "status",
  "cost",
  "updated",
];
```

to:

```ts
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "findings",
  "status",
  "cost",
  "updated",
];
```

In `messages/en/prReview.json`, find the `list.columns` object (sibling keys `pullRequest`, `author`, `size`, `score`, `status`, `cost`, `updated`) and add `"findings": "Findings"` alongside them, matching existing casing/style.

- [ ] **Step 5: Render the badges + tooltip in `PRRow`**

Add imports to `PRRow.tsx`:

```ts
import { SEV, type Severity } from "@devdigest/ui";
import { FindingsTooltip } from "@/components/findings-tooltip";
```

Insert a new cell between the score cell (ends at line 56, `</div>`) and the status cell (`<div><Badge dot ...>`):

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        {(["CRITICAL", "WARNING", "SUGGESTION"] as Severity[]).map((sev) => {
          const items = pr.findings_summary?.items.filter((f) => f.severity === sev) ?? [];
          const count = pr.findings_summary?.counts[sev] ?? 0;
          const SevIcon = Icon[SEV[sev].icon];
          return (
            <FindingsTooltip key={sev} findings={items}>
              <span
                data-testid={`pr-findings-badge-${sev}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, color: SEV[sev].c }}
              >
                <SevIcon size={12} />
                {count}
              </span>
            </FindingsTooltip>
          );
        })}
      </div>
```

`Icon` is already imported in `PRRow.tsx:7`; no change needed there.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/_components/PRRow/PRRow.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full client suite + typecheck**

Run: `cd client && pnpm typecheck && pnpm test`
Expected: PASS, no regressions in the pulls list / header row snapshot-style tests (if any assert on `GRID`/`COLUMN_KEYS` length, they'll need the same one-column bump — fix inline if so).

- [ ] **Step 8: Commit**

```bash
git add client/src/app/repos/\[repoId\]/pulls/constants.ts client/src/app/repos/\[repoId\]/pulls/_components/PRRow messages/en/prReview.json
git commit -m "feat(pulls-list): add FINDINGS column with per-severity hover tooltip"
```

---

## Post-plan note (deliberate deviation from the design doc)

The design doc mentioned adjusting the unused `PrRowView.findings` type in
`client/src/lib/types.ts:38-48`. `PRRow.tsx` consumes `PrMeta` directly, never
`PrRowView` — so no task above touches it. Leaving that dead type alone is a
smaller, safer diff than repurposing something nothing reads; flag it to the
user as optional cleanup, not part of this feature.
