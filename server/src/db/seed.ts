import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model, plus six demo skills
 * (test-quality-corner-cases, linked to Test Quality Reviewer;
 * api-contract-change, linked to Security Reviewer; breaking-change,
 * response-schema, semver-discipline, deprecation-policy, all linked in
 * order to API Contract Reviewer).
 *
 * Course lessons populate the other tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Flags uncovered branches, missing corner cases, over-mocking, and flaky patterns.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Flags breaking API contract changes without a version bump or deprecation path.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo skills (idempotent by name) + agent links ----
  const [testQualityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));
  const [securityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));

  async function upsertSkill(values: {
    name: string;
    description: string;
    type: 'rubric' | 'convention' | 'security' | 'custom';
    body: string;
  }): Promise<string> {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, values.name)));
    if (existing) return existing.id;
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: 'manual',
        body: values.body,
        enabled: true,
        version: 1,
      })
      .returning();
    await db.insert(t.skillVersions).values({ skillId: row!.id, version: 1, body: row!.body }).onConflictDoNothing();
    return row!.id;
  }

  const testQualitySkillId = await upsertSkill({
    name: 'test-quality-corner-cases',
    description: 'Flag test files that only cover the happy path — missing corner cases and branch coverage.',
    type: 'rubric',
    body: `# Test Quality — Corner Cases

For every test file changed in the diff, check that it exercises:
- At least one non-happy-path branch (error, empty, or boundary case) for
  each function it tests.
- No test that mocks the exact unit under test.

If a test file only asserts the happy path, flag it as a WARNING finding
citing the test file and the untested branch in the production code it
covers.`,
  });

  const apiContractSkillId = await upsertSkill({
    name: 'api-contract-change',
    description: 'Flag any exported route handler signature change without a version bump.',
    type: 'convention',
    body: `# API Contract Change

If the diff changes the parameters, return type, or path of an exported
route handler (Fastify route, REST endpoint) without also changing a version
identifier (route path version segment, or an explicit schema version field),
flag it as a WARNING finding: "breaking API contract change without a
version bump", citing the changed handler's file:line.`,
  });

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
A consumer reading \`.email\` now gets \`undefined\` at runtime with no error.

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

  if (testQualityAgent) {
    await db
      .insert(t.agentSkills)
      .values({ agentId: testQualityAgent.id, skillId: testQualitySkillId, order: 0 })
      .onConflictDoUpdate({ target: [t.agentSkills.agentId, t.agentSkills.skillId], set: { order: 0 } });
  }
  if (securityAgent) {
    await db
      .insert(t.agentSkills)
      .values({ agentId: securityAgent.id, skillId: apiContractSkillId, order: 0 })
      .onConflictDoUpdate({ target: [t.agentSkills.agentId, t.agentSkills.skillId], set: { order: 0 } });
  }

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

  // ---- demo eval cases (idempotent by name) — one per control-experiment scenario ----
  async function upsertEvalCase(values: {
    ownerId: string;
    name: string;
    inputDiff: string;
    expectedOutput: unknown;
  }): Promise<void> {
    const [existing] = await db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.name, values.name)));
    if (existing) return;
    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: values.ownerId,
      name: values.name,
      inputDiff: values.inputDiff,
      expectedOutput: values.expectedOutput,
    });
  }

  if (testQualityAgent) {
    await upsertEvalCase({
      ownerId: testQualityAgent.id,
      name: 'happy-path-only-test',
      inputDiff: `diff --git a/test/add.test.ts b/test/add.test.ts\n--- a/test/add.test.ts\n+++ b/test/add.test.ts\n@@ -1,2 +1,5 @@\n test('happy path', () => {\n+  expect(add(1, 2)).toBe(3);\n });`,
      expectedOutput: [{ severity: 'WARNING', file: 'test/add.test.ts', category: 'test' }],
    });
  }
  if (securityAgent) {
    await upsertEvalCase({
      ownerId: securityAgent.id,
      name: 'route-signature-change',
      inputDiff: `diff --git a/src/routes/users.ts b/src/routes/users.ts\n--- a/src/routes/users.ts\n+++ b/src/routes/users.ts\n@@ -1,3 +1,3 @@\n-export async function getUser(id: string): Promise<User> {\n+export async function getUser(id: string, opts: { includeDeleted: boolean }): Promise<User> {`,
      expectedOutput: [{ severity: 'WARNING', file: 'src/routes/users.ts', category: 'bug' }],
    });
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
