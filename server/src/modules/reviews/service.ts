import type { Container } from '../../platform/container.js';
import type { FindingActionKind, PrIntentRecord, RunEventKind, RunTrace } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow, FindingRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding, toPrIntentRecord } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { IntentClassificationService } from './intent-service.js';
import { clusterFindings, type FindingCluster } from './findings-cluster.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; `agentIds` → an
   * explicit subset run together as one multi-agent group (T3) — ANY unknown/
   * foreign id 404s immediately, before any `agent_runs` row is created
   * (AC-12); else a single agent via `agentId`.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean; agentIds?: string[] },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentIds && opts.agentIds.length > 0) {
      const resolved: AgentRow[] = [];
      for (const id of opts.agentIds) {
        const agent = await this.agents.getById(workspaceId, id);
        if (!agent) throw new NotFoundError('Agent not found');
        resolved.push(agent);
      }
      return resolved;
    }
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId, all:true, or agentIds', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    reviews: ReviewDto[];
    run_group_id: string | null;
  }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // T4 — 2+ resolved targets (whether from an explicit `agentIds` subset or
    // `all:true` with 2+ enabled agents) are linked under one `multi_agent_runs`
    // row, created BEFORE any `agent_runs` row so every row below can carry
    // its id (AC-14). A single target stays ungrouped (AC-15).
    const runGroupId =
      targets.length > 1 ? await this.repo.createMultiAgentRun({ workspaceId, prId }) : null;

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId: runGroupId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [], run_group_id: runGroupId };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  /**
   * The PR's persisted intent classification, if any — a standalone read so
   * the client can cache/invalidate it independently of the whole PR detail
   * payload (which also embeds `intent`, kept for the initial page load).
   */
  async getIntent(workspaceId: string, prId: string): Promise<{ intent: PrIntentRecord | null }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const persisted = await this.repo.getIntent(prId);
    return { intent: persisted ? toPrIntentRecord(prId, persisted) : null };
  }

  /**
   * Manual re-classification — bypasses the `headSha` cache unconditionally.
   * For the case the automatic pre-work cache check can't cover: a reviewer
   * edits the PR description (or a linked issue/plan changes) WITHOUT a new
   * commit, so `headSha` is unchanged but the classifier's input isn't.
   * Synchronous (unlike `runReview`'s fire-and-forget) — it's one cheap call,
   * not N agent runs, so the caller can just await the fresh result.
   */
  async refreshIntent(workspaceId: string, prId: string, logger?: Logger): Promise<{ intent: PrIntentRecord }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repo);
    const intentSvc = new IntentClassificationService(this.container, this.repo);
    const outcome = await intentSvc.classify(
      workspaceId,
      pull,
      { id: repo.id, owner: repo.owner, name: repo.name },
      diff,
      logger,
      { force: true },
    );

    const persisted = {
      ...outcome.intent,
      providerUsed: outcome.providerUsed,
      modelUsed: outcome.modelUsed,
      headSha: pull.headSha,
    };
    return { intent: toPrIntentRecord(prId, persisted) };
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  /**
   * T14 — reviews + a findings-clustering view scoped to an explicit set of
   * `run_ids` (a multi-agent group's sibling runs). Reuses `reviewsForPull`'s
   * existing DB call (`this.repo.reviewsForPull`) and filters in memory by
   * `run_id` — `reviews.run_id` has no DB-level uniqueness/FK to `agent_runs`
   * (server INSIGHTS.md 2026-08-20), so this must not assume it at the query
   * layer, same as `reviewsForPull` already doesn't.
   */
  async reviewGroupsForRunIds(
    workspaceId: string,
    prId: string,
    runIds: string[],
  ): Promise<{ reviews: ReviewDto[]; clusters: FindingCluster[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const rows = await this.repo.reviewsForPull(prId);
    const runIdSet = new Set(runIds);
    const scoped = rows.filter(({ review }) => review.runId !== null && runIdSet.has(review.runId));

    const names = new Map<string, string>();
    for (const { review } of scoped) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }

    const reviews = scoped.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );

    const items: { finding: FindingRow; agentId: string | null; agentName: string | null }[] = [];
    for (const { review, findings } of scoped) {
      const agentName = review.agentId ? names.get(review.agentId) ?? null : null;
      for (const finding of findings) {
        items.push({ finding, agentId: review.agentId, agentName });
      }
    }

    return { reviews, clusters: clusterFindings(items) };
  }

  /**
   * The review (+ findings) produced by a given agent_run, keyed by run_id
   * alone — no pull/workspace id required from the caller (see
   * `getReviewByRunId`'s doc comment). Undefined if no review was persisted
   * for that run yet (still running, or the run_id doesn't exist).
   */
  async findingsForRun(runId: string): Promise<ReviewDto | undefined> {
    const found = await this.repo.getReviewByRunId(runId);
    if (!found) return undefined;
    const { review, findings } = found;
    let agentName: string | null = null;
    if (review.agentId) {
      const a = await this.agents.getById(review.workspaceId, review.agentId);
      if (a) agentName = a.name;
    }
    return reviewToDto(review, findings, agentName);
  }
}
