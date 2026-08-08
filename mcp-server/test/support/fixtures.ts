import type {
  Agent,
  BlastRadius,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/** Minimal, valid fixtures for the shared contracts these tools consume —
 * one factory per shape, override only what a given test cares about. */

export function repoFixture(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

export function prFixture(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 482,
    title: 'Add retry logic',
    author: 'octocat',
    branch: 'feat/retries',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: 'open',
    ...overrides,
  };
}

export function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Flags security issues in diffs.',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    system_prompt: 'You are a security reviewer.',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function conventionFixture(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'conv-1',
    rule: 'Validate all request bodies with Zod at the route boundary.',
    category: 'validation',
    evidence_path: 'server/src/modules/repos/routes.ts',
    evidence_snippet: "{ schema: { body: RepoInput } }",
    evidence_line: 26,
    confidence: 0.9,
    accepted: false,
    status: 'pending',
    ...overrides,
  };
}

export function runSummaryFixture(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
    ...overrides,
  };
}

export function findingRecordFixture(
  overrides: Partial<ReviewRecord['findings'][number]> = {},
): ReviewRecord['findings'][number] {
  return {
    id: 'finding-1',
    review_id: 'review-1',
    accepted_at: null,
    dismissed_at: null,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Unvalidated user input reaches a raw SQL query',
    file: 'src/db/query.ts',
    start_line: 10,
    end_line: 14,
    rationale: 'User-controlled input is concatenated into the query string.',
    suggestion: 'Use a parameterized query.',
    confidence: 0.92,
    kind: 'finding',
    in_scope: null,
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

export function blastRadiusFixture(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [{ file: 'src/payments/retry.ts', name: 'retryWithBackoff', kind: 'function' }],
    downstream: [
      {
        symbol: 'retryWithBackoff',
        callers: [{ name: 'chargeCard', file: 'src/payments/service.ts', line: 42 }],
        endpoints_affected: ['POST /payments/charge'],
        crons_affected: [],
      },
    ],
    summary: '1 symbol(s) changed, 1 caller(s), 1 endpoint(s) potentially affected',
    ...overrides,
  };
}

export function reviewRecordFixture(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'One critical finding.',
    score: 40,
    model: 'claude-3-5-sonnet',
    grounding: null,
    created_at: '2026-08-06T00:00:00.000Z',
    findings: [findingRecordFixture()],
    ...overrides,
  };
}
