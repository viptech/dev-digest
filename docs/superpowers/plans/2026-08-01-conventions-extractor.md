# Conventions Extractor — Implementation Plan (Plan B of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-repo Conventions page that scans a cloned repo's
top-ranked source files, has an LLM propose house-rule candidates with file
evidence, and lets the user accept/reject each candidate.

**Architecture:** New server module `conventions` runs a 2-step LLM flow:
step 1 asks the model to pick which of `repoIntel.getConventionSamples()`'s
candidate files are worth reading (schema `ConventionFileSelection`); step 2
reads those files' content and asks the model to extract rule candidates with
evidence (schema `ConventionExtraction`). Results are persisted to the
already-existing `conventions` table (`accepted: false`). Client is a
per-repo route (`/repos/:repoId/conventions`, matching the existing
`/repos/:repoId/pulls` pattern) with a card list and accept/reject.

**Tech Stack:** Fastify + zod (server), `completeStructured` (LLM structured
output, `server/src/vendor/shared/adapters.ts`), Drizzle/Postgres, Next.js 15
+ React Query (client), next-intl.

## Global Constraints

(Same constraints as Plan A — `docs/superpowers/plans/2026-08-01-skills-core.md`
§ Global Constraints — apply unchanged: snake_case wire contracts, generated
migrations via `drizzle-kit generate`, avoid `pnpm exec`/`pnpm run` in this
sandbox (call binaries directly), dual `vendor/shared` copies, module shape
`routes.ts`+`service.ts`+`repository.ts`, client feature-folder shape.)

- **Depends on Plan A being merged first**: this plan does not touch
  `run-executor.ts` or skills, but it does share the nav file
  (`client/src/vendor/ui/nav.ts`) that Plan A Task 7 already modified — start
  this plan from a branch/worktree that has Plan A's commits.
- `conventions` table already exists (`server/src/db/schema/knowledge.ts`) —
  no migration needed.
- `ConventionCandidate` contract already exists identically in both
  `server/src/vendor/shared/contracts/knowledge.ts` and the client copy — no
  contract change needed.
- Extracted rules are NOT auto-injected into any agent's prompt in this
  iteration (explicit design decision) — the page is self-contained
  extract → review → accept/reject.

---

## File Structure

**Server:**
- `server/src/modules/repo-intel/service.ts` — add `readFiles(repoId, paths)`
  (modify; reuses the existing private `readClone` helper in the same file).
- `server/src/db/rows.ts` — `ConventionRow` export (modify).
- `server/src/modules/conventions/repository.ts` — CRUD over `conventions`.
- `server/src/modules/conventions/constants.ts` — sampling/selection caps.
- `server/src/modules/conventions/helpers.ts` — row↔DTO mapping, LLM schemas.
- `server/src/modules/conventions/service.ts` — the 2-step extraction flow.
- `server/src/modules/conventions/routes.ts` — HTTP.
- `server/src/modules/index.ts` — register the module (modify).
- `server/test/conventions.it.test.ts` — integration test (extraction flow
  end to end against `MockLLMProvider`, accept/reject, workspace scoping).

**Client:**
- `client/src/vendor/ui/nav.ts` — add `Conventions` under `SKILLS LAB`
  (modify).
- `client/src/lib/hooks/conventions.ts` — React Query hooks.
- `client/src/app/repos/[repoId]/conventions/page.tsx` — thin route entry.
- `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/{ConventionsView.tsx,helpers.ts,styles.ts,index.ts,ConventionsView.test.tsx}`
- `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/{ConventionCard.tsx,styles.ts,index.ts,ConventionCard.test.tsx}`

---

## Task 1: `RepoIntelService.readFiles` + `ConventionRow`

**Files:**
- Modify: `server/src/modules/repo-intel/service.ts`
- Modify: `server/src/db/rows.ts`

**Interfaces:**
- Consumes: `this.repo.getRepoBasics(repoId)` (existing,
  `server/src/modules/repo-intel/repository.ts:136`), private `readClone`
  (existing, same file, line ~762).
- Produces: `RepoIntelService.readFiles(repoId: string, paths: string[]):
  Promise<{ path: string; content: string }[]>` — skips files that fail to
  read (deleted/binary/no clone), never throws.

- [ ] **Step 1: Add the method**

In `server/src/modules/repo-intel/service.ts`, add a new public method right
after `getConventionSamples` (found earlier at line ~630):

```ts
  /**
   * Read the CONTENT of specific repo-relative paths from the local clone.
   * Best-effort: a missing clone or an individual unreadable file is skipped,
   * never thrown — callers (conventions extraction) degrade to fewer samples
   * rather than failing the whole request.
   */
  async readFiles(repoId: string, paths: string[]): Promise<{ path: string; content: string }[]> {
    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return [];
    const out: { path: string; content: string }[] = [];
    for (const path of paths) {
      const content = await readClone(repo.clonePath, path);
      if (content !== null) out.push({ path, content });
    }
    return out;
  }
```

`readClone` is already a module-scope function in this file (not a class
method) — confirm this by reading around line 762 before adding the call
above; it takes `(clonePath: string, file: string): Promise<string | null>`.

- [ ] **Step 2: `ConventionRow`**

In `server/src/db/rows.ts`, add:
```ts
export type ConventionRow = typeof t.conventions.$inferSelect;
```

- [ ] **Step 3: Typecheck**

```bash
cd server && node_modules/.bin/tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/modules/repo-intel/service.ts server/src/db/rows.ts
git commit -m "feat(repo-intel): add readFiles for conventions extraction"
```

---

## Task 2: Conventions repository + constants + helpers (DTO + LLM schemas)

**Files:**
- Create: `server/src/modules/conventions/constants.ts`
- Create: `server/src/modules/conventions/repository.ts`
- Create: `server/src/modules/conventions/helpers.ts`
- Test: `server/test/conventions-helpers.test.ts`

**Interfaces:**
- Consumes: `t.conventions` (`server/src/db/schema.ts`), `ConventionRow`
  (Task 1).
- Produces:
  - `class ConventionsRepository` with `listByRepo(workspaceId, repoId)`,
    `insertMany(rows)`, `deleteUnaccepted(workspaceId, repoId)`,
    `updateOne(workspaceId, id, patch)`.
  - `toConventionDto(row: ConventionRow): ConventionCandidate`
  - `ConventionFileSelectionSchema`, `ConventionExtractionSchema` (zod, for
    `completeStructured`).
  - `SAMPLE_COUNT = 15`, `MAX_SELECTED_FILES = 8`, `MAX_FILE_CHARS = 4000`,
    `MAX_CANDIDATES = 10`.

- [ ] **Step 1: Constants**

Create `server/src/modules/conventions/constants.ts`:
```ts
/** How many top-ranked files repo-intel offers as extraction candidates. */
export const SAMPLE_COUNT = 15;
/** Cap on how many of those the model may select to actually read (cost control). */
export const MAX_SELECTED_FILES = 8;
/** Per-file content cap sent to the extraction call (token-budget guard, same
 *  pattern as reviewer-core's MAX_PR_DESCRIPTION_CHARS). */
export const MAX_FILE_CHARS = 4000;
/** Cap on how many rule candidates one extraction run persists. */
export const MAX_CANDIDATES = 10;
```

- [ ] **Step 2: Repository**

Create `server/src/modules/conventions/repository.ts`:
```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** A1/T-conventions — data-access for `conventions`. Workspace + repo scoped. */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  evidencePath?: string | null;
  evidenceSnippet?: string | null;
  confidence?: number | null;
}

export interface UpdateConvention {
  rule?: string;
  accepted?: boolean;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }

  async insertMany(rows: InsertConvention[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          rule: r.rule,
          evidencePath: r.evidencePath ?? null,
          evidenceSnippet: r.evidenceSnippet ?? null,
          confidence: r.confidence ?? null,
          accepted: false,
        })),
      )
      .returning();
  }

  /** Drop candidates the user never accepted, before a re-scan writes fresh
   *  ones — keeps the list from growing unbounded across repeated "Extract"
   *  clicks while preserving anything already accepted. */
  async deleteUnaccepted(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, false),
        ),
      );
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async updateOne(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
```

- [ ] **Step 3: Write the failing test for the DTO mapper**

Create `server/test/conventions-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toConventionDto } from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/modules/conventions/repository.js';

describe('toConventionDto', () => {
  it('maps a full row', () => {
    const row: ConventionRow = {
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'Use snake_case for wire contracts',
      evidencePath: 'server/src/vendor/shared/contracts/platform.ts',
      evidenceSnippet: 'head_sha: text(...)',
      confidence: 0.82,
      accepted: false,
    };
    expect(toConventionDto(row)).toEqual({
      id: 'c1',
      rule: 'Use snake_case for wire contracts',
      evidence_path: 'server/src/vendor/shared/contracts/platform.ts',
      evidence_snippet: 'head_sha: text(...)',
      confidence: 0.82,
      accepted: false,
    });
  });

  it('maps null evidence/confidence to null, not undefined', () => {
    const row: ConventionRow = {
      id: 'c2',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'No default exports',
      evidencePath: null,
      evidenceSnippet: null,
      confidence: null,
      accepted: true,
    };
    const dto = toConventionDto(row);
    expect(dto.evidence_path).toBeNull();
    expect(dto.confidence).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd server && node_modules/.bin/vitest run test/conventions-helpers.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 5: Write `helpers.ts`**

Create `server/src/modules/conventions/helpers.ts`:
```ts
import { z } from 'zod';
import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? null,
    evidence_snippet: row.evidenceSnippet ?? null,
    confidence: row.confidence ?? null,
    accepted: row.accepted,
  };
}

/** Step 1 — the model picks which sampled files are worth reading in full. */
export const ConventionFileSelectionSchema = z.object({
  files: z.array(z.string()).describe('Repo-relative paths worth reading for conventions, chosen from the candidate list.'),
});
export type ConventionFileSelection = z.infer<typeof ConventionFileSelectionSchema>;

/** Step 2 — extracted rule candidates with file evidence. */
export const ConventionExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      rule: z.string(),
      evidence_path: z.string(),
      evidence_snippet: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ConventionExtraction = z.infer<typeof ConventionExtractionSchema>;
```

- [ ] **Step 6: Run it to verify it passes**

```bash
cd server && node_modules/.bin/vitest run test/conventions-helpers.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

```bash
cd server && node_modules/.bin/tsc --noEmit
```
Expected: no errors. (`ConventionCandidate`'s `evidence_path`/`evidence_snippet`/
`confidence` fields are `.nullish()` per the contract read during design —
confirm `z.string().nullish()`/`z.number().nullish()` there accepts `null`
before trusting the mapping above; if the contract only allows `undefined`
not `null`, use `evidencePath ?? undefined` instead of `?? null` to match.)

- [ ] **Step 8: Commit**

```bash
git add server/src/modules/conventions/constants.ts \
       server/src/modules/conventions/repository.ts \
       server/src/modules/conventions/helpers.ts \
       server/test/conventions-helpers.test.ts
git commit -m "feat(conventions): add repository + DTO mapping + LLM schemas"
```

---

## Task 3: Conventions service (2-step extraction) + routes + registration

**Files:**
- Create: `server/src/modules/conventions/service.ts`
- Create: `server/src/modules/conventions/routes.ts`
- Modify: `server/src/modules/index.ts`
- Test: `server/test/conventions.it.test.ts`

**Interfaces:**
- Consumes: `ConventionsRepository` (Task 2), `container.repoIntel.getConventionSamples`
  (existing), `container.repoIntel.readFiles` (Task 1),
  `resolveFeatureModel(container, workspaceId, 'conventions')`
  (`server/src/modules/settings/feature-models.js`, existing),
  `container.llm(provider)` (existing).
- Produces:
  - `class ConventionsService` with `list(workspaceId, repoId)`,
    `extract(workspaceId, repoId): Promise<ConventionCandidate[]>`,
    `update(workspaceId, id, patch): Promise<ConventionCandidate | undefined>`.
  - Routes: `GET /repos/:repoId/conventions`, `POST
    /repos/:repoId/conventions/extract`, `PUT /conventions/:id`.

- [ ] **Step 1: Write the service**

Create `server/src/modules/conventions/service.ts`:
```ts
import type { ConventionCandidate, Provider } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository } from './repository.js';
import {
  toConventionDto,
  ConventionFileSelectionSchema,
  ConventionExtractionSchema,
} from './helpers.js';
import { MAX_CANDIDATES, MAX_FILE_CHARS, MAX_SELECTED_FILES, SAMPLE_COUNT } from './constants.js';

export interface UpdateConventionInput {
  rule?: string;
  accepted?: boolean;
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionInput,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateOne(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * 2-step LLM extraction: (1) pick which of the top-ranked sample files are
   * worth reading, (2) read those files and extract rule candidates with
   * evidence. Degrades to [] (no throw) when repo-intel has no samples or
   * the clone has no readable files — matches repo-intel's existing
   * best-effort contract.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const samples = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT);
    if (samples.length === 0) return this.list(workspaceId, repoId);

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider as Provider);

    const selection = await llm.completeStructured({
      model,
      schema: ConventionFileSelectionSchema,
      schemaName: 'ConventionFileSelection',
      messages: [
        {
          role: 'system',
          content:
            'You select which files are most likely to reveal a codebase\'s house conventions ' +
            '(naming, error handling, module structure, testing patterns). Prefer files that look ' +
            'representative, not one-off scripts or generated code.',
        },
        {
          role: 'user',
          content: `Candidate files (top-ranked by import centrality):\n${samples.join('\n')}\n\nPick up to ${MAX_SELECTED_FILES} worth reading in full.`,
        },
      ],
    });

    const selected = selection.data.files
      .filter((f) => samples.includes(f))
      .slice(0, MAX_SELECTED_FILES);
    if (selected.length === 0) return this.list(workspaceId, repoId);

    const files = await this.container.repoIntel.readFiles(repoId, selected);
    if (files.length === 0) return this.list(workspaceId, repoId);

    const filesBlock = files
      .map((f) => `### ${f.path}\n${f.content.slice(0, MAX_FILE_CHARS)}`)
      .join('\n\n');

    const extraction = await llm.completeStructured({
      model,
      schema: ConventionExtractionSchema,
      schemaName: 'ConventionExtraction',
      messages: [
        {
          role: 'system',
          content:
            'You extract concrete, enforceable house conventions from source code — naming rules, ' +
            'error-handling patterns, module boundaries, testing conventions. Each candidate must cite ' +
            'the exact file and a short code snippet as evidence. Do not invent conventions you cannot ' +
            'point to in the given files.',
        },
        { role: 'user', content: filesBlock },
      ],
    });

    const candidates = extraction.data.candidates.slice(0, MAX_CANDIDATES);

    await this.repo.deleteUnaccepted(workspaceId, repoId);
    await this.repo.insertMany(
      candidates.map((c) => ({
        workspaceId,
        repoId,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    return this.list(workspaceId, repoId);
  }
}
```

`container.repoIntel` — confirm the container exposes it as a getter (like
`container.agentsRepo`) returning `RepoIntelService`; this is already used
elsewhere in the codebase (`this.container.repoIntel.getFileRank(...)` seen
in `run-executor.ts` during design research), so the property name is
confirmed as `repoIntel`.

- [ ] **Step 2: Write the routes**

Create `server/src/modules/conventions/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module.
 *   GET  /repos/:repoId/conventions          → list candidates for a repo
 *   POST /repos/:repoId/conventions/extract  → run the 2-step LLM extraction
 *   PUT  /conventions/:id                    → accept/reject/edit one candidate
 */

const RepoParams = z.object({ repoId: z.string().uuid() });

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  accepted: z.boolean().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:repoId/conventions', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.repoId);
  });

  app.post(
    '/repos/:repoId/conventions/extract',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.repoId);
    },
  );

  app.put(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention candidate not found');
      return updated;
    },
  );
}
```

- [ ] **Step 3: Register the module**

In `server/src/modules/index.ts`, add:
```ts
import conventions from './conventions/routes.js';
```
and add `conventions,` to the `modules` object.

- [ ] **Step 4: Write the integration test**

Create `server/test/conventions.it.test.ts`. This needs a repo with a
`clonePath` pointing at real files on disk (repo-intel's `readClone` reads
from the filesystem) — use a temp directory with a couple of fixture files,
and seed `repos.clonePath` to point at it. It also needs `repo_rank`/file-rank
data for `getConventionSamples` to return anything — check
`server/src/modules/repo-intel/repository.ts`'s `getRankedPaths` and whichever
table backs it (`file_rank` per earlier design research), and seed a couple of
rows directly:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FILE_SELECTION = { files: ['src/service.ts'] };
const EXTRACTION = {
  candidates: [
    {
      rule: 'Services are named `<Domain>Service` and take a Container in the constructor.',
      evidence_path: 'src/service.ts',
      evidence_snippet: 'export class WidgetService { constructor(private container: Container) {} }',
      confidence: 0.9,
    },
  ],
};

d('conventions extraction (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = mkdtempSync(join(tmpdir(), 'conv-fixture-'));
    writeFileSync(
      join(clonePath, 'service.ts'),
      'export class WidgetService {\n  constructor(private container: Container) {}\n}\n',
    );
  });
  afterAll(async () => {
    await pg?.stop();
    rmSync(clonePath, { recursive: true, force: true });
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              ConventionFileSelection: { files: ['src/service.ts'] },
              ConventionExtraction: EXTRACTION,
            },
          }),
        },
      },
    });
  }

  it('extracts candidates, lists them, accepts one, re-extract preserves the accepted one', async () => {
    const app = await appWith();

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-repo', fullName: 'acme/conv-repo', clonePath })
      .returning();
    // Seed one ranked file so getConventionSamples returns something.
    await pg.handle.db.insert(t.fileRank).values({
      repoId: repo!.id,
      filePath: 'src/service.ts',
      pagerank: 1,
      hotness: 0,
      rank: 1,
      percentile: 99,
    });

    const extracted = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
    });
    expect(extracted.statusCode).toBe(200);
    const candidates = extracted.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].rule).toContain('WidgetService');
    expect(candidates[0].accepted).toBe(false);

    const accept = await app.inject({
      method: 'PUT',
      url: `/conventions/${candidates[0].id}`,
      payload: { accepted: true },
    });
    expect(accept.json().accepted).toBe(true);

    // re-extract: the accepted one survives (deleteUnaccepted only removes accepted=false rows)
    await app.inject({ method: 'POST', url: `/repos/${repo!.id}/conventions/extract` });
    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repo!.id}/conventions` })
    ).json();
    expect(after.filter((c: { accepted: boolean }) => c.accepted)).toHaveLength(1);

    await app.close();
  });
});
```

The table is `file_rank` (Drizzle export `t.fileRank`,
`server/src/db/schema/repo-intel.ts:105`), PK `(repoId, filePath)`, with
NOT NULL `pagerank`, `hotness`, `rank` (all `doublePrecision`) and
`percentile` (`smallint`) — the insert above supplies all of them; do not
drop any or the insert will violate NOT NULL.

- [ ] **Step 5: Run it**

```bash
cd server && node_modules/.bin/vitest run test/conventions.it.test.ts
```
Expected: PASS if Docker is available; SKIP otherwise.

- [ ] **Step 6: Full server suite**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/conventions/service.ts server/src/modules/conventions/routes.ts \
       server/src/modules/index.ts server/test/conventions.it.test.ts
git commit -m "feat(conventions): add 2-step LLM extraction + routes"
```

---

## Task 4: Client hooks + nav entry

**Files:**
- Create: `client/src/lib/hooks/conventions.ts`
- Modify: `client/src/vendor/ui/nav.ts`

**Interfaces:**
- Consumes: `api` (`client/src/lib/api.ts`), `ConventionCandidate`
  (`@devdigest/shared`).
- Produces: `useConventions(repoId)`, `useExtractConventions(repoId)`,
  `useUpdateConvention(repoId)`.

- [ ] **Step 1: Hooks**

Create `client/src/lib/hooks/conventions.ts`:
```ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { rule?: string; accepted?: boolean } }) =>
      api.put<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
```

- [ ] **Step 2: Nav entry**

In `client/src/vendor/ui/nav.ts`, in the `SKILLS LAB` group added by Plan A
Task 7, add a `Conventions` item after `Skills`:
```ts
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
```
and a matching shortcut in `SHORTCUTS`:
```ts
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
```

- [ ] **Step 3: Typecheck**

```bash
cd client && node_modules/.bin/tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/hooks/conventions.ts client/src/vendor/ui/nav.ts
git commit -m "feat(conventions): add client hooks + nav entry"
```

---

## Task 5: `ConventionsView` page

**Files:**
- Create: `client/src/app/repos/[repoId]/conventions/page.tsx`
- Create: `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/{ConventionCard.tsx,styles.ts,index.ts,ConventionCard.test.tsx}`
- Create: `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/{ConventionsView.tsx,styles.ts,index.ts,ConventionsView.test.tsx}`

**Interfaces:**
- Consumes: `useConventions`, `useExtractConventions`, `useUpdateConvention`
  (Task 4); `useActiveRepo` (`@/lib/repo-context`, existing, used the same way
  in `client/src/app/repos/[repoId]/pulls/page.tsx`); i18n namespace
  `conventions` (already defined in `client/messages/en/conventions.json` —
  use `page.headingPrefix`, `page.subtitle`, `page.runExtraction`,
  `page.scanning`, `page.empty.*`, `card.confidence`, `card.acceptAsSkill` —
  NOTE: `card.acceptAsSkill` is mislabeled copy from an earlier concept
  ("Accept as Skill") that doesn't match this plan's design (conventions are
  NOT converted into skills here) — use the label but wire it to `accepted:
  true` via `useUpdateConvention`, not to skill creation; if this reads
  confusingly in the UI, that's an acceptable known copy mismatch to leave for
  a future pass, not a blocker for this plan).

- [ ] **Step 1: `ConventionCard`**

Create `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/styles.ts`:
```ts
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  rule: { fontSize: 14, fontWeight: 600 } as React.CSSProperties,
  evidence: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 6,
    padding: 8,
    whiteSpace: "pre-wrap",
  } as React.CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } as React.CSSProperties,
};
```

Create `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx`:
```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  onAccept,
  accepting,
}: {
  candidate: ConventionCandidate;
  onAccept: () => void;
  accepting?: boolean;
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.card}>
      <div style={s.rule}>{candidate.rule}</div>
      {candidate.evidence_path && (
        <div style={s.evidence}>
          {candidate.evidence_path}
          {candidate.evidence_snippet ? `\n${candidate.evidence_snippet}` : ""}
        </div>
      )}
      <div style={s.footer}>
        {candidate.confidence != null && (
          <Badge color="var(--text-secondary)">
            {t("card.confidence")}: {Math.round(candidate.confidence * 100)}%
          </Badge>
        )}
        {candidate.accepted ? (
          <Badge color="var(--ok)">{t("card.accepted")}</Badge>
        ) : (
          <Button kind="secondary" size="sm" onClick={onAccept} disabled={accepting}>
            {accepting ? t("card.accepting") : t("card.acceptAsSkill")}
          </Button>
        )}
      </div>
    </div>
  );
}
```

Create `.../ConventionCard/index.ts`: `export { ConventionCard } from "./ConventionCard";`

Create `.../ConventionCard/ConventionCard.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConventionCard } from "./ConventionCard";
import type { ConventionCandidate } from "@devdigest/shared";

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  rule: "Services take a Container in the constructor.",
  evidence_path: "src/service.ts",
  evidence_snippet: "constructor(private container: Container) {}",
  confidence: 0.9,
  accepted: false,
};

describe("ConventionCard", () => {
  it("renders rule + evidence + confidence", () => {
    render(<ConventionCard candidate={CANDIDATE} onAccept={vi.fn()} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText(/src\/service\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
  });

  it("shows an Accepted badge instead of the accept button when accepted", () => {
    render(<ConventionCard candidate={{ ...CANDIDATE, accepted: true }} onAccept={vi.fn()} />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("calls onAccept when the accept button is clicked", () => {
    const onAccept = vi.fn();
    render(<ConventionCard candidate={CANDIDATE} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onAccept).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd client && node_modules/.bin/vitest run src/app/repos/\[repoId\]/conventions/_components/ConventionCard
```
Expected: PASS (3 tests).

- [ ] **Step 3: `ConventionsView`**

Create `.../ConventionsView/styles.ts` — mirror
`client/src/app/skills/_components/SkillsListView/styles.ts` from Plan A
(same `page`/`header`/`headerText`/`h1`/`subtitle`/`grid` shape).

Create `.../ConventionsView/ConventionsView.tsx`:
```tsx
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [acceptingId, setAcceptingId] = React.useState<string | null>(null);

  const accept = async (id: string) => {
    setAcceptingId(id);
    await update.mutateAsync({ id, patch: { accepted: true } });
    setAcceptingId(null);
  };

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              {repoName}
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="RefreshCw"
            onClick={() => extract.mutate()}
            disabled={extract.isPending}
          >
            {extract.isPending
              ? t("page.scanning")
              : (candidates?.length ?? 0) > 0
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={100} />
            <Skeleton height={100} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {extract.isError && <ErrorState body={t("page.extractionFailed")} onRetry={() => extract.mutate()} />}
        {!isLoading && !isError && (candidates?.length ?? 0) === 0 && !extract.isPending && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}
        {(candidates?.length ?? 0) > 0 && (
          <>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {t("page.candidateCount", { count: candidates!.length })}
            </p>
            <div style={s.grid}>
              {candidates!.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  onAccept={() => accept(c.id)}
                  accepting={acceptingId === c.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
```

Create `.../ConventionsView/index.ts`: `export { ConventionsView } from "./ConventionsView";`

- [ ] **Step 4: Page entry**

Create `client/src/app/repos/[repoId]/conventions/page.tsx`:
```tsx
import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions. Thin route entry. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
```

- [ ] **Step 5: `ConventionsView` test**

Create `.../ConventionsView/ConventionsView.test.tsx`, mocking
`useConventions`/`useExtractConventions`/`useUpdateConvention` and
`next/navigation`'s `useParams` (return `{ repoId: "r1" }`) and
`@/lib/repo-context`'s `useActiveRepo` (return `{ activeRepo: { full_name:
"acme/demo" } }`), following the same `vi.mock` pattern used in Plan A's
`SkillsListView.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConventionsView } from "./ConventionsView";

const extractMutate = vi.fn();
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: [
      {
        id: "c1",
        rule: "Services take a Container.",
        evidence_path: "src/service.ts",
        evidence_snippet: "ctor",
        confidence: 0.9,
        accepted: false,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false, isError: false }),
  useUpdateConvention: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { full_name: "acme/demo" } }) }));

describe("ConventionsView", () => {
  it("renders the heading with the repo name and the candidate list", () => {
    render(<ConventionsView />);
    expect(screen.getByText(/acme\/demo/)).toBeInTheDocument();
    expect(screen.getByText("Services take a Container.")).toBeInTheDocument();
  });

  it("clicking the extract button triggers extraction", () => {
    render(<ConventionsView />);
    screen.getByText("Re-scan").click();
    expect(extractMutate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run all conventions client tests**

```bash
cd client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/app/repos/\[repoId\]/conventions
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/app/repos/\[repoId\]/conventions
git commit -m "feat(conventions): add per-repo Conventions page"
```

---

## Final Task: Verification

- [ ] **Step 1: Full-repo checks**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
cd ../client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

- [ ] **Step 2: Manual pass**

Boot the stack, open `/repos/<a repo with a clone>/conventions`, click "Run
extraction", confirm candidates appear with evidence, accept one, re-run
extraction, confirm the accepted one survives and unaccepted ones refresh.

- [ ] **Step 3: Insight capture**

Invoke `engineering-insights` if anything non-obvious surfaced (e.g. the
actual `file_rank` table/column names if they differed from the plan's
guess).
