import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers, formatIntentForPrompt } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import {
  REVIEW_STRATEGY,
  MAX_CONTEXT_DOC_CHARS,
  MAX_CONTEXT_DOCS_TOTAL_CHARS,
} from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { IntentClassificationService } from './intent-service.js';
import { categorizePath } from '../project-context/discovery.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // Intent Layer — shared pre-work, once per PR, cached by head_sha. Failure
    // here must NEVER block the review: unlike diff loading (mandatory), a
    // classifier failure/timeout is logged via runLog.info (not .error, to
    // avoid implying a broken run) and every agent simply omits `## Intent`.
    let intentText: string | undefined;
    let intentStats: RunTrace['stats']['intent'];
    try {
      const intentSvc = new IntentClassificationService(this.container, this.repo);
      const t0 = Date.now();
      runLog.info('Classifying PR intent…');
      const outcome = await intentSvc.classify(
        workspaceId,
        pull,
        { id: repo.id, owner: repo.owner, name: repo.name },
        diff,
        logger,
      );
      intentText = formatIntentForPrompt(outcome.intent);
      intentStats = outcome.stats;
      runLog.info(
        `Intent classified (${outcome.intent.confidence} confidence, source=${outcome.intent.source}) — ${Date.now() - t0}ms`,
      );
      // Same safe, structured prompt-assembly log as the main review call
      // (see below) — for the classifier's OWN prompt. Two distinct calls,
      // two distinct log lines, both name/source/length/model only, never
      // content. Zero-cost/no-op on a cache hit (outcome.sections is empty).
      if (outcome.sections.length > 0) {
        runLog.info('Prompt assembled', {
          // Pre-work is shared across every queued run for this PR (fanned
          // out into each one's Live Log/trace) — correlate by prId, same as
          // the fan-out ctx below, rather than picking one arbitrary runId.
          prId: pull.id,
          call: 'intent-classification',
          model: outcome.modelUsed,
          sectionCount: outcome.sections.length,
          totalChars: outcome.sections.reduce((n, s) => n + s.chars, 0),
          totalApproxTokens: outcome.sections.reduce((n, s) => n + s.approxTokens, 0),
          tokensIn: outcome.stats.tokens_in,
          tokensOut: outcome.stats.tokens_out,
          ...(this.container.config.promptLogVerbose ? { sections: outcome.sections } : {}),
        });
      }
    } catch (err) {
      runLog.info(`Intent classification skipped: ${(err as Error).message}`);
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          runLog,
          intentText,
          intentStats,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    /** Intent Layer — already formatted for the prompt (shared across every
     *  agent in this batch); undefined when classification was skipped/failed. */
    intentText?: string,
    intentStats?: RunTrace['stats']['intent'],
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      // SPEC-01 — manual per-agent/per-skill attachment, ALWAYS on (never
      // gated by the repo_intel toggle above — separate slot, separate
      // opt-in unit: the user attaches docs explicitly per agent/skill).
      const projectContext = await this.buildProjectContextDigest(agent, runLog);

      const task = taskLine(pull) + rankNote;

      // A1 — resolve this agent's linked, ENABLED skills into ordered body
      // strings. Disabled-at-the-skill-level or unlinked skills never reach
      // the prompt (agent_skills membership alone is not enough — the
      // skill's own `enabled` flag gates it too).
      const linkedSkills = await this.agents.linkedSkills(agent.id);
      const enabledSkills = linkedSkills.filter((l) => l.skill.enabled);
      const skillBodies = enabledSkills.map((l) => l.skill.body);
      const skillIds = enabledSkills.map((l) => l.skill.id);

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // A1 — linked+enabled skill bodies, same omit-when-empty contract.
        ...(skillBodies.length ? { skills: skillBodies } : {}),
        // SPEC-01 — attached specs, same omit-when-empty contract.
        // `assemblePrompt` already wraps each entry with `wrapUntrusted()`.
        ...(projectContext ? { specs: projectContext.specs } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Intent Layer — untrusted, delimiter-wrapped by assemblePrompt. Omitted
        // when classification was skipped/failed (same omit-when-empty contract).
        ...(intentText ? { intent: intentText } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      // Safe, structured prompt-assembly log — section name/source/length and
      // the resolved model, correlated by runId (already in runLog's context,
      // repeated here explicitly so it's greppable straight off the data
      // payload). NEVER includes section content, the diff, or spec text —
      // `outcome.sections` only ever carries name/source/chars/approxTokens
      // (see PromptSectionMeta). The full per-section array only appears when
      // `PROMPT_LOG_VERBOSE=true` locally (forced off in production); the
      // aggregate totals are logged either way.
      runLog.info('Prompt assembled', {
        runId,
        call: 'review',
        model: agent.model,
        mode: outcome.mode,
        sectionCount: outcome.sections.length,
        totalChars: outcome.sections.reduce((n, s) => n + s.chars, 0),
        totalApproxTokens: outcome.sections.reduce((n, s) => n + s.approxTokens, 0),
        tokensIn,
        tokensOut,
        ...(this.container.config.promptLogVerbose ? { sections: outcome.sections } : {}),
      });

      const keptFindings = outcome.review.findings;

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, keptFindings);
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: agent_runs + ONE run_traces document --------------
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
        skillIds: skillIds.length ? skillIds : null,
      });

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
          // Classification ran ONCE and is shared across every queued agent —
          // recorded here (not duplicated per-agent-cost) since each run gets
          // its own persisted trace and this is the simplest place a reader
          // can find "what did the shared pre-work cost".
          intent: intentStats ?? null,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: projectContext?.specsRead ?? [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * SPEC-01 (Project Context) — resolve the agent's manually-attached `.md`
   * documents (AC-9/AC-10) and read each from its OWN bound repo (AC-11:
   * `doc.repoId`, never `pull.repoId` — cross-repo context is the intended,
   * supported case). Best-effort/omit-when-empty, same contract as
   * `buildCallersDigest`/`buildRepoMapDigest` — NEVER gated by the
   * per-agent `repo_intel` toggle (this is a separate, always-on manual-
   * attachment slot, not repo-intel auto-enrichment).
   *
   * Each entry is prefixed with `### <owner>/<name> — <path>` (AC-13) before
   * becoming one `ReviewInput.specs[i]` element — `assemblePrompt` already
   * wraps it with `wrapUntrusted()` into `## Project context`, no
   * `reviewer-core` change needed. `specsRead` mirrors what actually made it
   * in (post size-cap truncation/omission), formatted `"<owner>/<name>:<path>"`
   * (AC-16).
   */
  private async buildProjectContextDigest(
    agent: AgentRow,
    runLog: RunLogger,
  ): Promise<{ specs: string[]; specsRead: string[] } | undefined> {
    let docs;
    try {
      docs = await this.container.projectContext.resolveAgentContext(agent.id);
    } catch (err) {
      runLog.info(`project context: resolution failed — ${(err as Error).message}`);
      return undefined;
    }
    if (docs.length === 0) return undefined;

    // AC-15 defense-in-depth: re-check the "under one of the configured
    // roots" half immediately before read (the clone-escape half is already
    // covered generically by the now-hardened readClone/readFiles below —
    // this re-check only needs the roots half, per the plan's step 5.3).
    const valid = docs.filter((d) => {
      if (categorizePath(d.path)) return true;
      runLog.info(`project context: ${d.owner}/${d.name}:${d.path} outside allowed roots — dropped`);
      return false;
    });
    if (valid.length === 0) return undefined;

    // Read once per distinct repo (AC-11) — a failing repo's docs are
    // skipped, not fatal to the whole digest (AC-12).
    const byRepo = new Map<string, { paths: string[] }>();
    for (const d of valid) {
      const g = byRepo.get(d.repoId) ?? { paths: [] };
      g.paths.push(d.path);
      byRepo.set(d.repoId, g);
    }
    const contentByKey = new Map<string, string>();
    for (const [repoId, g] of byRepo) {
      try {
        const files = await this.container.repoIntel.readFiles(repoId, g.paths);
        for (const f of files) contentByKey.set(`${repoId}:${f.path}`, f.content);
      } catch (err) {
        runLog.info(`project context: reading repo ${repoId} failed — ${(err as Error).message}`);
      }
    }

    const specs: string[] = [];
    const specsRead: string[] = [];
    let totalChars = 0;
    for (const d of valid) {
      const content = contentByKey.get(`${d.repoId}:${d.path}`);
      if (content === undefined) {
        // Renamed/deleted in ITS OWN bound repo — AC-12, best-effort skip.
        runLog.info(`project context: ${d.owner}/${d.name}:${d.path} not found — skipped`);
        continue;
      }
      let body = content;
      let truncated = false;
      if (body.length > MAX_CONTEXT_DOC_CHARS) {
        body = body.slice(0, MAX_CONTEXT_DOC_CHARS);
        truncated = true;
      }
      if (totalChars + body.length > MAX_CONTEXT_DOCS_TOTAL_CHARS) {
        runLog.info(
          `project context: aggregate budget reached — stopping before ${d.owner}/${d.name}:${d.path}`,
        );
        break; // never counted as "actually added" — omitted from specs AND specsRead
      }
      totalChars += body.length;
      const note = truncated ? '\n\n[truncated — exceeds per-document limit]' : '';
      specs.push(`### ${d.owner}/${d.name} — ${d.path}\n${body}${note}`);
      specsRead.push(`${d.owner}/${d.name}:${d.path}`);
    }

    if (specs.length === 0) return undefined;
    runLog.info(
      `project context: ${specs.length} document(s) attached, ${totalChars} char(s) (~${Math.ceil(totalChars / 4)} token(s))`,
    );
    return { specs, specsRead };
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
