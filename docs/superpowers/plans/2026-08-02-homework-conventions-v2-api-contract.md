# Homework — Conventions Extractor v2 + API Contract Reviewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-built Conventions Extractor with a code-only
sampling mode, evidence verification, categories, GitHub deep-links,
accept/reject/edit, and a "create skill from accepted candidates" flow; seed
a new **API Contract Reviewer** agent with 4 skills (breaking-change,
response-schema, semver-discipline, deprecation-policy) — satisfying the L02
homework brief.

**Architecture:** Additive changes to the existing `server/src/modules/conventions`
module (new `sampling_mode` param, `status`/`category`/`evidence_line`
columns, a post-extraction verification pass) and its client counterpart
(`ConventionCard`, `ConventionsView`, a new create-skill modal). New seed
data reuses the existing idempotent upsert patterns already in `seed.ts`.

**Tech Stack:** Fastify + zod + Drizzle (server), Next.js + React Query
(client), same stack as the rest of the repo.

## Global Constraints

(Same Global Constraints as the four prior plans on this branch — snake_case
wire contracts, migrations generated via `drizzle-kit generate` never
hand-written, `pnpm exec`/`pnpm run` can hang in this sandbox (call binaries
directly: `node node_modules/drizzle-kit/bin.cjs generate`,
`node_modules/.bin/vitest`, `node_modules/.bin/tsc`), and — **critically,
already bitten this exact feature three times** — `server/src/vendor/shared`
and `client/src/vendor/shared` are two physically separate copies of
`@devdigest/shared` with no sync mechanism: any contract change MUST be
applied identically to both and diffed to confirm.)

- Branch: `feat/homework-l02` (based on `feat/skills-in-product`, which is
  already merged via PR #3 — this plan's commits are new work on top).
- Do not touch the `api-contract-change` skill or its link to `Security
  Reviewer` (from the earlier Skills-core plan) — this plan adds a
  *separate* agent and skills, it does not replace that one.
- `ConventionsRepository.replaceUnaccepted` (transactional delete+insert) is
  the established pattern for the extract-mutation path — any new
  server-side database work in `extract()` should compose with it, not
  bypass it.

---

## File Structure

**Server:**
- `server/src/db/schema/knowledge.ts` — add `evidenceLine`, `category`,
  `status` columns to `conventions` (modify).
- `server/src/db/migrations/00NN_*.sql` — generated.
- `server/src/vendor/shared/contracts/knowledge.ts` (both copies) —
  `ConventionCandidate` gains `category`, `evidence_line`, `status`.
- `server/src/modules/conventions/repository.ts` — thread new fields through
  `InsertConvention`/`UpdateConvention`/row mapping (modify).
- `server/src/modules/conventions/helpers.ts` — `toConventionDto` +
  `ConventionExtractionSchema` gain the new fields (modify).
- `server/src/modules/conventions/constants.ts` — config-file glob list
  (modify).
- `server/src/modules/conventions/sample-selection.ts` — new: code-only
  sample selection (configs + top-N via `getConventionSamples`).
- `server/src/modules/conventions/evidence-verification.ts` — new: verifies
  a candidate's `evidence_path`/`evidence_line` actually exist in the clone.
- `server/src/modules/conventions/service.ts` — `extract()` takes
  `samplingMode`, calls verification before persisting (modify).
- `server/src/modules/conventions/routes.ts` — `POST .../extract` accepts
  `sampling_mode`; `PUT /conventions/:id` accepts `status` (modify).
- `server/src/db/seed-prompts.ts` — `API_CONTRACT_REVIEWER_PROMPT` (modify).
- `server/src/db/seed.ts` — new agent + 4 skills, linked (modify).
- Tests: `server/test/conventions-sample-selection.test.ts`,
  `server/test/conventions-evidence-verification.test.ts`,
  `server/test/conventions-helpers.test.ts` (extend),
  `server/test/conventions.it.test.ts` (extend).

**Client:**
- `client/src/lib/hooks/conventions.ts` — `useUpdateConvention` patch type
  gains `status`; `useExtractConventions` accepts `sampling_mode`; new
  `useCreateSkillFromConventions` (modify + add).
- `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx`
  — Reject button, inline rule editing, GitHub link (modify).
- `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx`
  — sampling-mode toggle, "Create skill from accepted" button + modal mount
  (modify).
- `client/src/app/repos/[repoId]/conventions/_components/CreateSkillFromConventionsModal/{CreateSkillFromConventionsModal.tsx,helpers.ts,styles.ts,index.ts,CreateSkillFromConventionsModal.test.tsx}`
  — new.
- `client/messages/en/conventions.json` — new keys (modify).
- Tests: `ConventionCard.test.tsx` (extend), `ConventionsView.test.tsx`
  (extend).

---

## Task 1: DB migration — `evidence_line`, `category`, `status`

**Files:**
- Modify: `server/src/db/schema/knowledge.ts`
- Create: generated migration

**Interfaces:**
- Produces: `conventions.evidenceLine: integer | null`,
  `conventions.category: text` (NOT NULL, default `''`),
  `conventions.status: text` (enum `'pending'|'accepted'|'rejected'`, NOT
  NULL default `'pending'`). The existing `accepted: boolean` column is
  **kept, unchanged** for backward compatibility — it is now driven by
  `status` at the application layer (`accepted = status === 'accepted'`),
  not written independently.

- [ ] **Step 1: Edit the schema**

In `server/src/db/schema/knowledge.ts`, find the `conventions` table (it has
`id, workspaceId, repoId, rule, evidencePath, evidenceSnippet, confidence,
accepted`). Add three columns after `confidence` and before `accepted`:

```ts
  category: text('category').notNull().default(''),
  evidenceLine: integer('evidence_line'),
```

and after `accepted`:

```ts
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
    .notNull()
    .default('pending'),
```

Add `integer` to the file's existing `pgTable`/type import line if not
already imported (check — `evidenceLine` needs it; other tables in this repo
already import `integer` from `drizzle-orm/pg-core`, follow that exact
import style).

- [ ] **Step 2: Generate the migration**

```bash
cd server && node node_modules/drizzle-kit/bin.cjs generate
```
Expected: a new `server/src/db/migrations/00NN_*.sql` with three `ALTER
TABLE "conventions" ADD COLUMN ...` statements (category NOT NULL DEFAULT
'', evidence_line integer nullable, status NOT NULL DEFAULT 'pending').

- [ ] **Step 3: Apply and verify** (if Docker/Postgres available locally)

```bash
docker compose up -d
cd server && node_modules/.bin/tsx -e "
import { loadConfig } from './src/platform/config.js';
import { createDb } from './src/db/client.js';
import { runMigrations } from './src/db/migrate.js';
const cfg = loadConfig(process.env);
const { db, close } = createDb(cfg.databaseUrl);
await runMigrations(db);
await close();
console.log('migrated ok');
"
```
(If this hangs due to the known path-with-spaces `tsx` CLI-entrypoint bug —
documented in `server/INSIGHTS.md` — verify instead with a direct psql
`\d conventions` check after running migrations via whatever method already
worked in this checkout, e.g. `pnpm db:migrate` if that's unaffected.)

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema/knowledge.ts server/src/db/migrations
git commit -m "feat(db): add conventions.category/evidence_line/status columns"
```

---

## Task 2: Extend `ConventionCandidate` contract (both copies) + repository + helpers

**Files:**
- Modify: `server/src/vendor/shared/contracts/knowledge.ts`
- Modify: `client/src/vendor/shared/contracts/knowledge.ts`
- Modify: `server/src/modules/conventions/repository.ts`
- Modify: `server/src/modules/conventions/helpers.ts`
- Test: `server/test/conventions-helpers.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's new columns.
- Produces: `ConventionCandidate` gains `category: z.string()`,
  `evidence_line: z.number().int().nullish()`,
  `status: z.enum(['pending','accepted','rejected'])`. `InsertConvention`
  gains `category: string`, `evidenceLine?: number | null`.
  `UpdateConvention` gains `status?: 'pending'|'accepted'|'rejected'`.
  `toConventionDto` maps all new fields; `accepted` in the DTO stays derived
  (`row.status === 'accepted'`) — do not read `row.accepted` anymore in the
  mapper (the DB column still exists but the app layer treats `status` as
  the source of truth going forward).

- [ ] **Step 1: Extend the contract — server copy**

In `server/src/vendor/shared/contracts/knowledge.ts`, find:
```ts
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string().nullish(),
  evidence_snippet: z.string().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;
```
Replace with:
```ts
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  category: z.string(),
  evidence_path: z.string().nullish(),
  evidence_snippet: z.string().nullish(),
  evidence_line: z.number().int().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  accepted: z.boolean(),
  status: ConventionStatus,
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;
```
(`accepted` is kept on the wire, derived server-side, so nothing that reads
`candidate.accepted` elsewhere in the client breaks.)

- [ ] **Step 2: Apply the IDENTICAL edit to the client copy**

Apply the exact same replacement to
`client/src/vendor/shared/contracts/knowledge.ts`. Then run:
```bash
diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts
```
and confirm the `ConventionStatus`/`ConventionCandidate` blocks are
byte-identical between the two (unrelated pre-existing drift elsewhere in
the file is fine, do not touch it).

- [ ] **Step 3: Update the repository**

In `server/src/modules/conventions/repository.ts`:
- `InsertConvention` interface: add `category: string;` and
  `evidenceLine?: number | null;`.
- `UpdateConvention` interface: replace `accepted?: boolean;` with
  `status?: 'pending' | 'accepted' | 'rejected';` (drop `accepted` from this
  interface — callers now set `status`, not `accepted`, directly).
- `insertMany`: add `category: r.category,` and `evidenceLine: r.evidenceLine
  ?? null,` to the `.values(...)` mapping. The `accepted: false` literal
  already there can stay as-is (harmless legacy default) OR be replaced with
  `status: 'pending'` — add `status: 'pending',` explicitly alongside the
  existing `accepted: false,` so both columns start consistent.
- `updateOne`: replace the `accepted` conditional-set line with:
  ```ts
  ...(patch.status !== undefined ? { status: patch.status, accepted: patch.status === 'accepted' } : {}),
  ```
  (keeps the legacy `accepted` column in sync with `status` on every write,
  so any code that still reads the raw DB column directly — none currently,
  but defensive — stays correct).

- [ ] **Step 4: Update `toConventionDto` and `ConventionExtractionSchema`**

In `server/src/modules/conventions/helpers.ts`:
```ts
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    category: row.category,
    evidence_path: row.evidencePath ?? null,
    evidence_snippet: row.evidenceSnippet ?? null,
    evidence_line: row.evidenceLine ?? null,
    confidence: row.confidence ?? null,
    accepted: row.status === 'accepted',
    status: row.status as 'pending' | 'accepted' | 'rejected',
  };
}
```
And extend `ConventionExtractionSchema`'s per-candidate object with two new
required fields (the LLM must supply them):
```ts
export const ConventionExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      category: z.string().describe('Short category, e.g. "naming", "error-handling", "testing", "structure".'),
      rule: z.string(),
      evidence_path: z.string(),
      evidence_line: z.number().int().describe('1-based line number in evidence_path where the pattern is shown.'),
      evidence_snippet: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
```

- [ ] **Step 5: Write/extend the DTO-mapper test**

In `server/test/conventions-helpers.test.ts`, update the existing fixture
rows to include `category`/`evidenceLine`/`status` and extend both existing
test cases' `expect(...)` blocks to assert the new fields map correctly
(including `status: 'accepted'` → `accepted: true` in the DTO, and
`status: 'pending'` → `accepted: false`).

- [ ] **Step 6: Typecheck both packages**

```bash
cd server && node_modules/.bin/tsc --noEmit
cd ../client && node_modules/.bin/tsc --noEmit
```
Expected: errors at every call site that still passes `{accepted: true}` to
`update.mutateAsync`/`UpdateConvention` — these are FIXED in Task 6
(client) and Task 4 (server routes), not this task; it's fine if this task
ends with client/route typecheck errors that a later task resolves, AS LONG
AS you note them in your report so they aren't mistaken for a regression.
Run `node_modules/.bin/vitest run test/conventions-helpers.test.ts` and
confirm it passes on its own.

- [ ] **Step 7: Commit**

```bash
git add server/src/vendor/shared/contracts/knowledge.ts \
       client/src/vendor/shared/contracts/knowledge.ts \
       server/src/modules/conventions/repository.ts \
       server/src/modules/conventions/helpers.ts \
       server/test/conventions-helpers.test.ts
git commit -m "feat(conventions): add category/evidence_line/status to the contract"
```

---

## Task 3: Code-only sample selection + evidence verification

**Files:**
- Create: `server/src/modules/conventions/sample-selection.ts`
- Create: `server/src/modules/conventions/evidence-verification.ts`
- Modify: `server/src/modules/conventions/constants.ts`
- Test: `server/test/conventions-sample-selection.test.ts`
- Test: `server/test/conventions-evidence-verification.test.ts`

**Interfaces:**
- Consumes: `Container['repoIntel']` (`getConventionSamples`, `readFiles` —
  both already exist).
- Produces:
  - `CONFIG_FILE_CANDIDATES: readonly string[]` (constants.ts).
  - `getCodeOnlySamples(repoIntel, repoId, n): Promise<string[]>` — returns
    config files that actually exist in the clone (checked via `readFiles`,
    one call for all candidates) concatenated with
    `getConventionSamples(repoId, n)`'s result, de-duplicated.
  - `verifyEvidence(repoIntel, repoId, candidates): Promise<T[]>` — generic
    over any `{evidence_path: string; evidence_line: number}`-shaped
    candidate; returns only the ones whose file reads successfully AND whose
    `evidence_line` is within `[1, fileLineCount]`.

- [ ] **Step 1: Config-file candidate list**

In `server/src/modules/conventions/constants.ts`, add:
```ts
/** Root-level config files worth reading as convention evidence, checked
 *  for existence before being added to the extraction sample (code-only
 *  sampling mode — no LLM call to pick these). */
export const CONFIG_FILE_CANDIDATES: readonly string[] = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
];
```

- [ ] **Step 2: Write the failing test**

Create `server/test/conventions-sample-selection.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { getCodeOnlySamples } from '../src/modules/conventions/sample-selection.js';

function mockRepoIntel(existingFiles: Set<string>, rankedFiles: string[]) {
  return {
    getConventionSamples: vi.fn().mockResolvedValue(rankedFiles),
    readFiles: vi.fn().mockImplementation(async (_repoId: string, paths: string[]) =>
      paths.filter((p) => existingFiles.has(p)).map((p) => ({ path: p, content: '// x' })),
    ),
  };
}

describe('getCodeOnlySamples', () => {
  it('includes existing config files plus the ranked samples, deduplicated', async () => {
    const repoIntel = mockRepoIntel(
      new Set(['tsconfig.json', '.eslintrc.json']),
      ['src/a.ts', 'src/b.ts'],
    );
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result).toEqual(expect.arrayContaining(['tsconfig.json', '.eslintrc.json', 'src/a.ts', 'src/b.ts']));
    expect(new Set(result).size).toBe(result.length); // no duplicates
  });

  it('skips config files that do not exist in the clone, without error', async () => {
    const repoIntel = mockRepoIntel(new Set([]), ['src/a.ts']);
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result).toEqual(['src/a.ts']);
  });

  it('deduplicates when a config file is also returned by getConventionSamples', async () => {
    const repoIntel = mockRepoIntel(new Set(['tsconfig.json']), ['tsconfig.json', 'src/a.ts']);
    const result = await getCodeOnlySamples(repoIntel as never, 'repo-1', 12);
    expect(result.filter((p) => p === 'tsconfig.json')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd server && node_modules/.bin/vitest run test/conventions-sample-selection.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `sample-selection.ts`**

Create `server/src/modules/conventions/sample-selection.ts`:
```ts
import { CONFIG_FILE_CANDIDATES } from './constants.js';

/** Minimal shape this module needs from RepoIntelService — kept narrow so
 *  it's trivially mockable in tests without importing the real interface. */
export interface SampleSelectionRepoIntel {
  getConventionSamples(repoId: string, n: number): Promise<string[]>;
  readFiles(repoId: string, paths: string[]): Promise<{ path: string; content: string }[]>;
}

/**
 * Code-only sample selection (no LLM call): root-level config files that
 * actually exist in the clone, plus the top-N ranked files from repo-intel.
 * Deduplicated. Used when `sampling_mode: 'code'` (the default per the
 * homework brief — deterministic, cheaper than the 'llm' file-selection
 * step).
 */
export async function getCodeOnlySamples(
  repoIntel: SampleSelectionRepoIntel,
  repoId: string,
  n: number,
): Promise<string[]> {
  const [existingConfigs, ranked] = await Promise.all([
    repoIntel.readFiles(repoId, [...CONFIG_FILE_CANDIDATES]).then((files) => files.map((f) => f.path)),
    repoIntel.getConventionSamples(repoId, n),
  ]);
  return [...new Set([...existingConfigs, ...ranked])];
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd server && node_modules/.bin/vitest run test/conventions-sample-selection.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing test for evidence verification**

Create `server/test/conventions-evidence-verification.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { verifyEvidence } from '../src/modules/conventions/evidence-verification.js';

function mockRepoIntel(files: Record<string, string>) {
  return {
    readFiles: vi.fn().mockImplementation(async (_repoId: string, paths: string[]) =>
      paths.filter((p) => p in files).map((p) => ({ path: p, content: files[p]! })),
    ),
  };
}

describe('verifyEvidence', () => {
  it('keeps a candidate whose file and line both exist', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\nline3\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 2, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(1);
  });

  it('drops a candidate whose file does not exist in the clone', async () => {
    const repoIntel = mockRepoIntel({});
    const candidates = [{ evidence_path: 'src/missing.ts', evidence_line: 1, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is beyond the file length', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 99, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('drops a candidate whose evidence_line is 0 or negative', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'line1\nline2\n' });
    const candidates = [{ evidence_path: 'src/a.ts', evidence_line: 0, rule: 'x' }];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result).toHaveLength(0);
  });

  it('keeps some and drops others in a mixed batch', async () => {
    const repoIntel = mockRepoIntel({ 'src/a.ts': 'l1\nl2\n' });
    const candidates = [
      { evidence_path: 'src/a.ts', evidence_line: 1, rule: 'good' },
      { evidence_path: 'src/gone.ts', evidence_line: 1, rule: 'bad-file' },
      { evidence_path: 'src/a.ts', evidence_line: 50, rule: 'bad-line' },
    ];
    const result = await verifyEvidence(repoIntel as never, 'repo-1', candidates);
    expect(result.map((c) => c.rule)).toEqual(['good']);
  });
});
```

- [ ] **Step 7: Run to verify it fails, then implement**

Create `server/src/modules/conventions/evidence-verification.ts`:
```ts
export interface EvidenceVerificationRepoIntel {
  readFiles(repoId: string, paths: string[]): Promise<{ path: string; content: string }[]>;
}

/**
 * Mechanically confirms each candidate's cited file exists in the clone and
 * its `evidence_line` is a valid 1-based line number within that file.
 * Candidates that fail either check are dropped BEFORE persistence — this is
 * a structural check only (file/line exist), not a semantic check that the
 * line actually demonstrates the claimed rule.
 */
export async function verifyEvidence<T extends { evidence_path: string; evidence_line: number }>(
  repoIntel: EvidenceVerificationRepoIntel,
  repoId: string,
  candidates: T[],
): Promise<T[]> {
  const paths = [...new Set(candidates.map((c) => c.evidence_path))];
  const files = await repoIntel.readFiles(repoId, paths);
  const lineCounts = new Map(files.map((f) => [f.path, f.content.split('\n').length]));

  return candidates.filter((c) => {
    const lineCount = lineCounts.get(c.evidence_path);
    if (lineCount === undefined) return false;
    return c.evidence_line >= 1 && c.evidence_line <= lineCount;
  });
}
```

- [ ] **Step 8: Run both test files, confirm pass**

```bash
cd server && node_modules/.bin/vitest run test/conventions-sample-selection.test.ts test/conventions-evidence-verification.test.ts
```
Expected: PASS (8 tests total).

- [ ] **Step 9: Typecheck + commit**

```bash
cd server && node_modules/.bin/tsc --noEmit
```
```bash
git add server/src/modules/conventions/sample-selection.ts \
       server/src/modules/conventions/evidence-verification.ts \
       server/src/modules/conventions/constants.ts \
       server/test/conventions-sample-selection.test.ts \
       server/test/conventions-evidence-verification.test.ts
git commit -m "feat(conventions): add code-only sample selection + evidence verification"
```

---

## Task 4: Wire `sampling_mode` + verification into `extract()`, update routes

**Files:**
- Modify: `server/src/modules/conventions/service.ts`
- Modify: `server/src/modules/conventions/routes.ts`
- Test: `server/test/conventions.it.test.ts` (extend)

**Interfaces:**
- Consumes: `getCodeOnlySamples`, `verifyEvidence` (Task 3); the existing
  `ConventionFileSelectionSchema`/2-step LLM flow (unchanged, used only when
  `samplingMode === 'llm'`).
- Produces: `ConventionsService.extract(workspaceId, repoId, samplingMode:
  'code' | 'llm' = 'code', logger?)`. `POST /repos/:repoId/conventions/extract`
  accepts `{ sampling_mode?: 'code' | 'llm' }` in the body. `PUT
  /conventions/:id` accepts `{ rule?: string; status?: 'pending'|'accepted'|'rejected' }`
  (no more bare `accepted` in the request body — this is the breaking route
  change flagged in Task 2 Step 6).

- [ ] **Step 1: Update `extract()`**

In `server/src/modules/conventions/service.ts`, change the method signature
and the file-selection branch:

```ts
  async extract(
    workspaceId: string,
    repoId: string,
    samplingMode: 'code' | 'llm' = 'code',
    logger?: Logger,
  ): Promise<ConventionCandidate[]> {
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider as Provider);

    let files: { path: string; content: string }[];

    if (samplingMode === 'code') {
      const samples = await getCodeOnlySamples(this.container.repoIntel, repoId, SAMPLE_COUNT);
      if (samples.length === 0) {
        logger?.warn({ repoId, workspaceId }, 'conventions.extract: no code-only samples found — repo may not be indexed or cloned');
        return this.list(workspaceId, repoId);
      }
      files = await this.container.repoIntel.readFiles(repoId, samples.slice(0, MAX_SELECTED_FILES));
    } else {
      const samples = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT);
      if (samples.length === 0) {
        logger?.warn({ repoId, workspaceId }, 'conventions.extract: no candidate files from repo-intel — repo may not be indexed');
        return this.list(workspaceId, repoId);
      }
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
      const selected = selection.data.files.filter((f) => samples.includes(f)).slice(0, MAX_SELECTED_FILES);
      if (selected.length === 0) {
        logger?.warn({ repoId, workspaceId }, 'conventions.extract: model selected no files that were actually offered — dropping the response');
        return this.list(workspaceId, repoId);
      }
      files = await this.container.repoIntel.readFiles(repoId, selected);
    }

    if (files.length === 0) {
      logger?.warn({ repoId, workspaceId }, 'conventions.extract: none of the selected files were readable from the clone');
      return this.list(workspaceId, repoId);
    }

    const filesBlock = files.map((f) => `### ${f.path}\n${f.content.slice(0, MAX_FILE_CHARS)}`).join('\n\n');

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
            'the exact file, line number, and a short code snippet as evidence. Do not invent conventions ' +
            'you cannot point to in the given files. Assign each candidate a short category ' +
            '(e.g. "naming", "error-handling", "testing", "structure").',
        },
        { role: 'user', content: filesBlock },
      ],
    });

    const rawCandidates = extraction.data.candidates.slice(0, MAX_CANDIDATES);
    const verified = await verifyEvidence(this.container.repoIntel, repoId, rawCandidates);
    if (verified.length < rawCandidates.length) {
      logger?.warn(
        { repoId, workspaceId, dropped: rawCandidates.length - verified.length },
        'conventions.extract: dropped candidates whose evidence file/line could not be verified',
      );
    }
    if (verified.length === 0) {
      logger?.warn({ repoId, workspaceId, filesRead: files.length }, 'conventions.extract: zero candidates survived evidence verification');
    }

    await this.repo.replaceUnaccepted(
      workspaceId,
      repoId,
      verified.map((c) => ({
        workspaceId,
        repoId,
        rule: c.rule,
        category: c.category,
        evidencePath: c.evidence_path,
        evidenceLine: c.evidence_line,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    return this.list(workspaceId, repoId);
  }
```

Add the import: `import { getCodeOnlySamples } from './sample-selection.js';`
and `import { verifyEvidence } from './evidence-verification.js';`.

- [ ] **Step 2: Update routes**

In `server/src/modules/conventions/routes.ts`:
```ts
const ExtractBody = z.object({
  sampling_mode: z.enum(['code', 'llm']).optional(),
});

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
});
```
Update the extract route to parse a body and pass `sampling_mode`:
```ts
  app.post(
    '/repos/:repoId/conventions/extract',
    { schema: { params: RepoParams, body: ExtractBody.optional() } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.repoId, req.body?.sampling_mode ?? 'code', req.log);
    },
  );
```
The `PUT /conventions/:id` handler body stays the same shape-wise (still
passes `req.body` straight to `service.update`) — only `UpdateConventionBody`'s
schema changed above, and `UpdateConventionInput` in `service.ts` needs its
`accepted?: boolean` field replaced with `status?: 'pending'|'accepted'|'rejected'`
to match (this mirrors Task 2 Step 3's repository-layer change — do this here
at the service layer too, `service.update`'s `patch: UpdateConventionInput`
type).

- [ ] **Step 3: Extend the integration test**

In `server/test/conventions.it.test.ts`, update the existing test's mock
`structuredBySchema.ConventionExtraction` fixture to include `category` and
`evidence_line` matching a real line in the test fixture file (the test
already writes a fixture file to a temp clone — find the line number of the
line containing the asserted evidence snippet and use that). Add a new
`it(...)` case: call extract with a `ConventionExtraction` mock response
containing one candidate with a valid `evidence_line` and one with an
out-of-range `evidence_line` (e.g. `9999`); assert the response has exactly
one candidate (the invalid one was dropped). Also add a case exercising
`sampling_mode: 'llm'` explicitly (the old 2-step flow) to confirm it still
works, reusing the existing `ConventionFileSelection` mock fixture.

- [ ] **Step 4: Run it**

```bash
cd server && node_modules/.bin/vitest run test/conventions.it.test.ts
```
Expected: PASS if Docker available, SKIP otherwise.

- [ ] **Step 5: Full server suite**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/conventions/service.ts server/src/modules/conventions/routes.ts \
       server/test/conventions.it.test.ts
git commit -m "feat(conventions): wire sampling_mode + evidence verification into extract()"
```

---

## Task 5: Client — Reject, inline edit, GitHub link, sampling-mode toggle

**Files:**
- Modify: `client/src/lib/hooks/conventions.ts`
- Modify: `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx`
- Modify: `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.test.tsx`
- Modify: `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx`
- Modify: `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.test.tsx`
- Modify: `client/messages/en/conventions.json`

**Interfaces:**
- Consumes: `ConventionCandidate` with `category`/`evidence_line`/`status`
  (Task 2, both contract copies already in sync).
- Produces: `ConventionCard` shows category badge, Reject button alongside
  Accept, an inline-editable rule textarea, a "View on GitHub" link when
  `evidence_path`+`evidence_line` are present and the repo context has
  `full_name`/`default_branch`. `ConventionsView` gets a sampling-mode
  select next to the extract button.

- [ ] **Step 1: Update the hooks**

In `client/src/lib/hooks/conventions.ts`:
- `useUpdateConvention`'s mutation `patch` type: change `{ rule?: string;
  accepted?: boolean }` to `{ rule?: string; status?: 'pending' | 'accepted'
  | 'rejected' }`.
- `useExtractConventions`: change `mutationFn: () =>
  api.post<ConventionCandidate[]>(...)` to accept an optional arg:
  ```ts
  export function useExtractConventions(repoId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (samplingMode?: 'code' | 'llm') =>
        api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`, samplingMode ? { sampling_mode: samplingMode } : undefined),
      onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
    });
  }
  ```

- [ ] **Step 2: Add i18n keys**

In `client/messages/en/conventions.json`, add under `card`: `"reject":
"Reject"`, `"rejecting": "Rejecting…"`, `"rejected": "Rejected"`,
`"editRule": "Edit"`, `"saveRule": "Save"`, `"cancelEdit": "Cancel"`,
`"viewOnGithub": "View on GitHub"`, `"category": "Category"`. Under `page`,
add `"samplingModeLabel": "Sampling"`, `"samplingModeCode": "Code-only
(deterministic)"`, `"samplingModeLlm": "LLM picks files"`.

- [ ] **Step 3: Update `ConventionCard`**

Rewrite to a three-state UI (pending shows both buttons; accepted shows an
Accepted badge + still-visible Reject to allow reverting; rejected shows a
Rejected badge + still-visible Accept to allow reverting) with inline rule
editing:

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  defaultBranch,
  onSetStatus,
  onSaveRule,
  busy,
  error,
}: {
  candidate: ConventionCandidate;
  repoFullName?: string;
  defaultBranch?: string;
  onSetStatus: (status: "accepted" | "rejected") => void;
  onSaveRule: (rule: string) => void;
  busy?: boolean;
  error?: string;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(candidate.rule);

  const githubUrl =
    repoFullName && defaultBranch && candidate.evidence_path && candidate.evidence_line
      ? `https://github.com/${repoFullName}/blob/${defaultBranch}/${candidate.evidence_path}#L${candidate.evidence_line}`
      : null;

  const saveRule = () => {
    onSaveRule(draftRule);
    setEditing(false);
  };

  return (
    <div style={s.card}>
      {editing ? (
        <>
          <Textarea value={draftRule} onChange={setDraftRule} rows={3} />
          <div style={s.footer}>
            <Button kind="ghost" size="sm" onClick={() => { setDraftRule(candidate.rule); setEditing(false); }}>
              {t("card.cancelEdit")}
            </Button>
            <Button kind="primary" size="sm" onClick={saveRule}>
              {t("card.saveRule")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={s.rule}>{candidate.rule}</div>
          {candidate.evidence_path && (
            <div style={s.evidence}>
              {githubUrl ? (
                <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                  {candidate.evidence_path}
                  {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
                </a>
              ) : (
                <>
                  {candidate.evidence_path}
                  {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
                </>
              )}
              {candidate.evidence_snippet ? `\n${candidate.evidence_snippet}` : ""}
            </div>
          )}
          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            <Badge color="var(--text-muted)">{candidate.category || t("card.category")}</Badge>
            {candidate.confidence != null && (
              <Badge color="var(--text-secondary)">
                {t("card.confidence")}: {Math.round(candidate.confidence * 100)}%
              </Badge>
            )}
            {candidate.status === "accepted" && <Badge color="var(--ok)">{t("card.accepted")}</Badge>}
            {candidate.status === "rejected" && <Badge color="var(--crit)">{t("card.rejected")}</Badge>}
            <Button kind="ghost" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              {t("card.editRule")}
            </Button>
            {candidate.status !== "accepted" && (
              <Button kind="secondary" size="sm" onClick={() => onSetStatus("accepted")} disabled={busy}>
                {busy ? t("card.accepting") : t("card.acceptAsSkill")}
              </Button>
            )}
            {candidate.status !== "rejected" && (
              <Button kind="ghost" size="sm" onClick={() => onSetStatus("rejected")} disabled={busy}>
                {busy ? t("card.rejecting") : t("card.reject")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

Check `Textarea`/`Badge`/`Button` are all exported from `@devdigest/ui`
(they are, used elsewhere) before finalizing imports.

- [ ] **Step 4: Update `ConventionCard.test.tsx`**

Rewrite the test file's props to match the new `onSetStatus`/`onSaveRule`
signature (read the CURRENT test file first for its exact provider-wrapping
pattern and mirror it). Cover: renders category badge, clicking Reject calls
`onSetStatus('rejected')`, clicking Accept calls `onSetStatus('accepted')`,
editing and saving the rule calls `onSaveRule` with the new text, GitHub
link renders with the correct href when `repoFullName`/`defaultBranch`/
`evidence_line` are all present, and does NOT render a link (renders plain
text) when any of those three are missing.

- [ ] **Step 5: Update `ConventionsView`**

Replace the single `accept`/`acceptingId`/`acceptErrorId` handling with a
generic `setStatus`/`busyId`/`errorId` handling that calls
`update.mutateAsync({ id, patch: { status } })`, and add a sampling-mode
`<select>` (or `SelectInput` from `@devdigest/ui`, matching the pattern used
elsewhere e.g. `CreateAgentModal`) next to the extract button, wired to
`extract.mutate(samplingMode)`. Pass `repoFullName={activeRepo?.full_name}`
and `defaultBranch={activeRepo?.default_branch}` to each `ConventionCard`.
Also pass a `onSaveRule={(rule) => update.mutate({ id: c.id, patch: { rule } })}`
handler.

- [ ] **Step 6: Update `ConventionsView.test.tsx`**

Extend the mocked `useConventions` fixture with `category`/`status`/
`evidence_line` fields; add a test that selecting the LLM sampling mode and
clicking extract calls `useExtractConventions`'s mutate with `'llm'`.

- [ ] **Step 7: Run and typecheck**

```bash
cd client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/app/repos/\[repoId\]/conventions
```
Expected: PASS, zero type errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/hooks/conventions.ts \
       client/src/app/repos/\[repoId\]/conventions \
       client/messages/en/conventions.json
git commit -m "feat(conventions): add reject/edit/GitHub-link UI + sampling-mode toggle"
```

---

## Task 6: "Create skill from accepted candidates" modal

**Files:**
- Create: `client/src/app/repos/[repoId]/conventions/_components/CreateSkillFromConventionsModal/{CreateSkillFromConventionsModal.tsx,helpers.ts,styles.ts,index.ts,CreateSkillFromConventionsModal.test.tsx}`
- Modify: `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx`
- Modify: `client/messages/en/conventions.json`

**Interfaces:**
- Consumes: `useCreateSkill` (`client/src/lib/hooks/skills.ts`, existing),
  `useSetAgentSkills`/`useAgentSkills` are NOT needed here — this modal only
  needs a way to link the new skill to ONE chosen agent, which is
  `POST /agents/:id/skills` with `{ skill_id }` (the existing route already
  supports linking one skill via `skill_id` — check
  `server/src/modules/agents/routes.ts`'s `SetSkillsBody`, which accepts
  EITHER `skill_ids` (full replace) OR `skill_id` (append one) — use the
  `skill_id` form here so this doesn't clobber the target agent's existing
  skill links). `useAgents` (`client/src/lib/hooks/agents.ts`, existing) for
  the agent picker.
- Produces: `CreateSkillFromConventionsModal({ accepted: ConventionCandidate[],
  onClose: () => void })` — generates a Markdown body from the accepted
  candidates, lets the user edit name/description/body/target agent, and on
  submit calls `POST /skills` then `POST /agents/:id/skills` with
  `{ skill_id }`.

- [ ] **Step 1: Helpers — generate the skill body**

Create `.../CreateSkillFromConventionsModal/helpers.ts`:
```ts
import type { ConventionCandidate } from "@devdigest/shared";

/** Render accepted convention candidates into a starting Markdown skill body. */
export function buildSkillBody(accepted: ConventionCandidate[]): string {
  const lines = accepted.map((c) => {
    const evidence = c.evidence_path
      ? ` (${c.evidence_path}${c.evidence_line ? `:${c.evidence_line}` : ""})`
      : "";
    return `- ${c.rule}${evidence}`;
  });
  return `# repo-conventions\n\n${lines.join("\n")}\n`;
}
```

- [ ] **Step 2: The component**

Create `.../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal.tsx`:
```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, SelectInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useAgents } from "@/lib/hooks/agents";
import { api } from "@/lib/api";
import { buildSkillBody } from "./helpers";

export function CreateSkillFromConventionsModal({
  accepted,
  onClose,
}: {
  accepted: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const { data: agents } = useAgents();
  const create = useCreateSkill();
  const [name, setName] = React.useState("repo-conventions");
  const [description, setDescription] = React.useState("House conventions extracted from this repo.");
  const [body, setBody] = React.useState(() => buildSkillBody(accepted));
  const [agentId, setAgentId] = React.useState(agents?.[0]?.id ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agentId && agents && agents.length > 0) setAgentId(agents[0]!.id);
  }, [agents, agentId]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const skill = await create.mutateAsync({ name, description, type: "convention", body });
      if (agentId) {
        await api.post(`/agents/${agentId}/skills`, { skill_id: skill.id });
      }
      onClose();
    } catch {
      setError(t("card.acceptFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      width={720}
      title={t("createSkillModal.title")}
      subtitle={t("createSkillModal.subtitle", { count: accepted.length })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("card.cancelEdit")}
          </Button>
          <Button kind="primary" onClick={submit} disabled={saving || !name.trim() || !body.trim() || !agentId}>
            {saving ? t("createSkillModal.saving") : t("createSkillModal.save")}
          </Button>
        </div>
      }
    >
      {error && <div style={{ color: "var(--crit)", marginBottom: 12 }}>{error}</div>}
      <FormField label={t("createSkillModal.nameLabel")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("createSkillModal.descriptionLabel")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("createSkillModal.agentLabel")} required>
        <SelectInput
          value={agentId}
          onChange={setAgentId}
          options={(agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
      </FormField>
      <FormField label={t("createSkillModal.bodyLabel")} required>
        <Textarea value={body} onChange={setBody} rows={14} mono />
      </FormField>
    </Modal>
  );
}
```

Check `api` is importable as `client/src/lib/api.ts`'s named export `api`
(confirmed elsewhere in the codebase — `api.post(path, body)`); check the
import alias `@/lib/...` is the established convention in this directory
(the sibling `ConventionsView.tsx` already uses `@/components/app-shell` /
`@/lib/repo-context` — mirror that exact alias style, don't mix relative and
`@/` imports in the same new file).

Create `.../CreateSkillFromConventionsModal/index.ts`:
```ts
export { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";
```
Create `.../CreateSkillFromConventionsModal/styles.ts` only if, after
writing the component above, there's real shared style logic to factor out
— the component above uses only inline styles and `FormField`, so this file
may be unnecessary; skip creating it if there is nothing to put there (no
placeholder files).

- [ ] **Step 3: Wire the button into `ConventionsView`**

Add a `showCreateSkill` boolean state and a button (enabled only when at
least one candidate has `status === 'accepted'`) that opens the modal,
passing `accepted={candidates!.filter(c => c.status === 'accepted')}`.

- [ ] **Step 4: Add i18n keys**

In `client/messages/en/conventions.json`, add a `createSkillModal` block:
`"title": "Create skill from accepted candidates"`, `"subtitle": "{count,
plural, one {# candidate} other {# candidates}} will be included"`,
`"nameLabel": "Skill name"`, `"descriptionLabel": "Description"`,
`"agentLabel": "Link to agent"`, `"bodyLabel": "Skill body (Markdown)"`,
`"save": "Create skill"`, `"saving": "Creating…"`. Add to `page`:
`"createSkillFromAccepted": "Create skill from accepted"`.

- [ ] **Step 5: Write the test**

Create `.../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal.test.tsx`
mocking `useCreateSkill`, `useAgents`, and `client/src/lib/api`'s `api.post`
(following the mocking conventions established in sibling test files in this
codebase, e.g. `SkillDrawer.test.tsx`). Cover: `buildSkillBody` output
contains every accepted candidate's rule and evidence reference; Save is
disabled without a name or without an agent selected; submitting calls
`useCreateSkill`'s mutation then `api.post` with the returned skill's id.

- [ ] **Step 6: Run and typecheck**

```bash
cd client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/app/repos/\[repoId\]/conventions
```

- [ ] **Step 7: Commit**

```bash
git add client/src/app/repos/\[repoId\]/conventions client/messages/en/conventions.json
git commit -m "feat(conventions): add Create-skill-from-accepted modal"
```

---

## Task 7: Seed — API Contract Reviewer agent + 4 skills

**Files:**
- Modify: `server/src/db/seed-prompts.ts`
- Modify: `server/src/db/seed.ts`

**Interfaces:**
- Consumes: the existing `upsertSkill`-style idempotent pattern already in
  `seed.ts` (from the Skills-core plan — read the current file for its exact
  shape before adding to it).
- Produces: a 5th built-in agent "API Contract Reviewer" (after "Test
  Quality Reviewer"), 4 new skills, all 4 linked to it.

- [ ] **Step 1: Write the agent prompt**

In `server/src/db/seed-prompts.ts`, add `API_CONTRACT_REVIEWER_PROMPT`
following the exact `# Role` / `# What to look for` / `# How to analyze` /
`# Quality bar` / `# Severity` / `# Verdict` / `# Findings discipline`
structure the other built-in prompts use (read `PERFORMANCE_REVIEWER_PROMPT`
in the same file as the closest template, per the established convention
from the Skills-core plan). Content focus: exported route handler signature
changes, response-shape changes, missing version bump on breaking changes,
silently removed/renamed fields instead of a deprecation path. Severity
guidance: CRITICAL = a breaking change to a contract with no version bump
and no deprecation notice; WARNING = a response-shape change that's
additive-but-risky (e.g. a field becoming optional when consumers may assume
required) or missing deprecation marking; SUGGESTION = a minor,
non-breaking API clarity nit.

- [ ] **Step 2: Write the 4 skill bodies**

In `server/src/db/seed.ts`, after the existing `upsertSkill` calls for
`test-quality-corner-cases`/`api-contract-change`, add 4 more calls (same
idempotent helper), each with a directive body containing a concrete
good/bad example:

```ts
  const breakingChangeSkillId = await upsertSkill({
    name: 'breaking-change',
    description: 'Flags removal or incompatible change of a public API contract.',
    type: 'convention',
    body: `# Breaking Change

Flag any diff that removes or incompatibly changes a PUBLIC contract: an
exported route handler's path/method/parameters, a required request field,
or an exported function/type other modules depend on.

## Bad
\`\`\`ts
// before: export async function getUser(id: string): Promise<User>
// after:
export async function getUser(id: string, opts: { includeDeleted: boolean }): Promise<User>
\`\`\`
A caller passing only \`id\` now gets a type error / runtime signature
mismatch with no deprecation path.

## Good
\`\`\`ts
export async function getUser(id: string, opts?: { includeDeleted?: boolean }): Promise<User>
\`\`\`
New parameter is optional — existing callers keep working.

Flag violations as WARNING or CRITICAL per the agent's severity rubric.`,
  });

  const responseSchemaSkillId = await upsertSkill({
    name: 'response-schema',
    description: 'Flags changes to a response shape — types, required/optional fields.',
    type: 'convention',
    body: `# Response Schema

Flag any diff that changes what a route returns: a field's type, a field
becoming required where it was optional (or vice versa in a way consumers
may not expect), or a field being removed from the response.

## Bad
\`\`\`ts
// before: { id: string; email: string }
// after:  { id: string }  // email silently dropped
\`\`\`
A consumer reading `.email` now gets `undefined` at runtime with no error.

## Good
\`\`\`ts
// email marked deprecated in the response type/docs for one release,
// then removed in a documented major version.
\`\`\`

Cite the exact file:line of the response type/schema change.`,
  });

  const semverDisciplineSkillId = await upsertSkill({
    name: 'semver-discipline',
    description: 'Flags a breaking change that lacks a corresponding version bump.',
    type: 'convention',
    body: `# Semver Discipline

When a diff contains a breaking API change (per the breaking-change /
response-schema skills), check whether the diff ALSO bumps a version
identifier (package version, API version segment in the route path, or an
explicit schema-version field). A breaking change with no version bump is a
CRITICAL finding, even if the change itself would otherwise be a WARNING.

## Bad
Route handler signature changes incompatibly; no version file, changelog, or
version-segment change anywhere else in the diff.

## Good
Route handler signature changes; \`package.json\`'s version is bumped (or the
route is added under a new \`/v2/\` path alongside the old one).`,
  });

  const deprecationPolicySkillId = await upsertSkill({
    name: 'deprecation-policy',
    description: 'Flags silent removal instead of a documented deprecation path.',
    type: 'convention',
    body: `# Deprecation Policy

When a diff removes a public field, parameter, or endpoint outright, flag it
UNLESS the diff shows evidence of a prior deprecation step (a \`@deprecated\`
marker, a deprecation warning log, or a changelog entry from an earlier
commit — judge from what's visible in the diff and PR description).

## Bad
A field is deleted from a response type in one commit, no prior deprecation
marker anywhere in the diff.

## Good
A field was marked \`@deprecated\` in a previous release (visible in the
diff's context/unchanged lines) and this diff is the follow-up removal after
the documented window.

Flag silent removals as WARNING (or CRITICAL if combined with a
semver-discipline violation).`,
  });
```

(The `upsertSkill` helper already exists in `seed.ts` from the Skills-core
plan — reuse it exactly as-is, do not redefine it.)

- [ ] **Step 3: Add the agent + link all 4 skills**

Add `API_CONTRACT_REVIEWER_PROMPT` to the existing `seedAgents` array (same
pattern as `Test Quality Reviewer`'s entry), then after the array's
insert-loop, add the linking block (mirroring the existing
`if (testQualityAgent) { await db.insert(t.agentSkills)... }` pattern):

```ts
  const [apiContractReviewerAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'API Contract Reviewer')));

  if (apiContractReviewerAgent) {
    const skillIds = [
      breakingChangeSkillId,
      responseSchemaSkillId,
      semverDisciplineSkillId,
      deprecationPolicySkillId,
    ];
    for (const [i, skillId] of skillIds.entries()) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: apiContractReviewerAgent.id, skillId, order: i })
        .onConflictDoUpdate({ target: [t.agentSkills.agentId, t.agentSkills.skillId], set: { order: i } });
    }
  }
```

- [ ] **Step 4: Verify idempotency and run**

Run the seed against a real Postgres if Docker is available (the CLI
entrypoint has the known path-with-spaces bug documented in
`server/INSIGHTS.md` — call `seed(db)` directly via a temporary local script
if `tsx src/db/seed.ts` no-ops, same workaround used in the Skills-core
plan), verify via psql that "API Contract Reviewer" has exactly 4 linked
skills in the expected order, then re-run seed and confirm no duplicates.

- [ ] **Step 5: Full server suite**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

- [ ] **Step 6: Commit**

```bash
git add server/src/db/seed-prompts.ts server/src/db/seed.ts
git commit -m "feat(seed): add API Contract Reviewer agent + 4 skills"
```

---

## Final Task: Verification

- [ ] **Step 1: Full-repo checks**

```bash
cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
cd ../client && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

- [ ] **Step 2: Manual pass (this is what the homework's demo video needs)**

Boot the stack. On a real cloned+indexed repo: `/repos/<id>/conventions` →
run extraction in `code` mode → confirm candidates appear with a category
badge and a clickable GitHub link → accept 1-2, reject 1 → click "Create
skill from accepted" → confirm the modal's generated body only includes the
accepted ones → save, linked to an agent → confirm the skill shows up
enabled on that agent's Skills tab. Separately: open `/agents` → confirm
"API Contract Reviewer" exists with its 4 skills linked in the Skills tab →
run it (with and without one of its skills toggled off) on a PR that renames
a response field or changes a route signature → confirm the skilled run
catches it and the unskilled run doesn't.

- [ ] **Step 3: Insight capture**

Invoke `engineering-insights` for anything non-obvious found during
implementation.
