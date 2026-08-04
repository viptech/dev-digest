import type { Provider, UnifiedDiff } from '@devdigest/shared';
import { Intent } from '@devdigest/shared';
import type { PromptSectionMeta } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { ReviewRepository, PullRow } from './repository.js';

/**
 * Intent Layer — a single, cheap, separately-modeled classification step that
 * runs once per PR (shared across every queued agent, not once per run).
 * Reads title/description/linked-issue/plan-spec + (when thin) indirect
 * signals, and produces a short structured Intent that `run-executor.ts`
 * folds into every agent's review prompt via `formatIntentForPrompt` +
 * `wrapUntrusted('intent', …)`.
 *
 * Mirrors `conventions/service.ts`'s `resolveFeatureModel` pattern: the model
 * is resolved through the DI container (`container.llm` / `resolveFeatureModel`),
 * never a bespoke fetch. Failure here must never block the review — callers
 * (run-executor) are responsible for catching and degrading gracefully.
 */

/** Minimal structured logger (pino-compatible: (obj, msg)). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export interface IntentClassificationResult {
  intent: Intent;
  providerUsed: string;
  modelUsed: string;
  /** Zero on a cache hit (no LLM call was made). */
  stats: { duration_ms: number; tokens_in: number; tokens_out: number; cost_usd: number | null };
  /**
   * Safe, content-free per-section sizing for the classifier's OWN prompt
   * (title/description/issue/plan-spec/hunk-headers/fallback signals) — same
   * shape as reviewer-core's `PromptSectionMeta`, for structured logging.
   * Empty on a cache hit (no prompt was built).
   */
  sections: PromptSectionMeta[];
}

/** Below this many non-boilerplate characters, the PR body counts as "thin". */
const THIN_BODY_CHARS = 40;

/** Cap how many files' hunk headers are folded into the classifier input. */
const MAX_HUNK_HEADER_FILES = 50;

/**
 * `path (+add/-del): @@ -oldStart,oldLines +newStart,newLines @@, ...` per
 * changed file — structural hunk headers only, never hunk body lines. This is
 * the "list of files with hunk headers, no change bodies" input the intent
 * classifier is scoped to (cheaper + no risk of leaking full diff content into
 * a cheap, less-trusted model call).
 */
function formatHunkHeaders(diff: UnifiedDiff): string {
  return diff.files
    .slice(0, MAX_HUNK_HEADER_FILES)
    .map((f) => {
      const headers = f.hunks
        .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
        .join(', ');
      return `${f.path} (+${f.additions}/-${f.deletions}): ${headers || '(no hunks)'}`;
    })
    .join('\n');
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sectionMeta(name: string, source: string, text: string | undefined): PromptSectionMeta | undefined {
  if (!text || text.length === 0) return undefined;
  return { name, source, chars: text.length, approxTokens: approxTokens(text) };
}

/** This repo's own plan/spec doc convention (confirmed in `docs/superpowers/`). */
const PLAN_SPEC_PATH_RE = /docs\/superpowers\/(?:plans|specs)\/[\w.\-/]+\.md/;
const BARE_URL_RE = /https?:\/\/[^\s)]+/g;
/** Jira-style ticket key (e.g. "PROJ-123") — surfaced as plain text, never fetched. */
const JIRA_KEY_RE = /\b[A-Z]{2,10}-\d{1,7}\b/;

/** Max chars of a resolved in-repo plan/spec file folded into the classifier input. */
const MAX_PLAN_SPEC_CHARS = 3000;

/** "Thin" per the plan's definition: empty, under ~40 chars, or pure boilerplate
 *  (markdown headers + unchecked template checklist items) after stripping. */
function isThinDescription(body: string | null | undefined): boolean {
  if (!body) return true;
  const stripped = body
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/^-\s*\[[ xX]]\s.*$/gm, '')
    .replace(/^>.*$/gm, '')
    .trim();
  return stripped.length < THIN_BODY_CHARS;
}

/** In-repo plan/spec path OR a cited (never-fetched) external plan/spec URL. */
function findPlanSpecRef(body: string | null | undefined): { path?: string; url?: string } | undefined {
  if (!body) return undefined;
  const pathMatch = body.match(PLAN_SPEC_PATH_RE);
  if (pathMatch) return { path: pathMatch[0] };
  const urls = body.match(BARE_URL_RE) ?? [];
  const specUrl = urls.find((u) => u.endsWith('.md') || u.includes('/plans/') || u.includes('/specs/'));
  return specUrl ? { url: specUrl } : undefined;
}

function findJiraKey(...candidates: (string | null | undefined)[]): string | undefined {
  for (const c of candidates) {
    const m = c?.match(JIRA_KEY_RE);
    if (m) return m[0];
  }
  return undefined;
}

export class IntentClassificationService {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
  ) {}

  /**
   * Classify (or reuse the cached classification for) a PR. Cache key is
   * `headSha` — mirrors `markReviewed(pull.id, pull.headSha)`'s staleness
   * check. A cache hit makes NO LLM call (stats all zero). Pass
   * `opts.force: true` to bypass the cache and reclassify unconditionally
   * (e.g. the user edited the PR description without pushing a new commit,
   * so `headSha` didn't change but the input did).
   */
  async classify(
    workspaceId: string,
    pull: PullRow,
    repoRow: { id: string; owner: string; name: string },
    diff: UnifiedDiff,
    logger?: Logger,
    opts: { force?: boolean } = {},
  ): Promise<IntentClassificationResult> {
    const cached = await this.repo.getIntent(pull.id);
    if (!opts.force && cached && cached.headSha === pull.headSha) {
      return {
        intent: {
          intent: cached.intent,
          in_scope: cached.in_scope,
          out_of_scope: cached.out_of_scope,
          confidence: cached.confidence,
          source: cached.source,
        },
        providerUsed: cached.providerUsed,
        modelUsed: cached.modelUsed,
        stats: { duration_ms: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 },
        sections: [],
      };
    }

    const start = Date.now();

    // ---- Best-effort linked issue (not persisted anywhere — PrDetail.linked_issue
    // is only assembled live by the pulls detail route, never stored on the pull
    // row — so this is a genuinely NEW, best-effort GitHub call, wrapped so a
    // missing token / offline mode degrades to "no linked issue" rather than
    // failing classification). ----
    let linkedIssue: { number: number; title: string; body?: string | null } | undefined;
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pull.number);
      if (detail.linked_issue) linkedIssue = detail.linked_issue;
    } catch (err) {
      logger?.debug({ err }, 'intent-service: linked issue lookup skipped');
    }

    // ---- Referenced plan/spec (in-repo resolved, external URL cited-only) ----
    const planSpecRef = findPlanSpecRef(pull.body);
    let planSpecContent: string | undefined;
    if (planSpecRef?.path) {
      try {
        const files = await this.container.repoIntel.readFiles(repoRow.id, [planSpecRef.path]);
        if (files[0]) planSpecContent = files[0].content.slice(0, MAX_PLAN_SPEC_CHARS);
      } catch (err) {
        logger?.debug({ err }, 'intent-service: plan/spec resolution skipped');
      }
    }

    const jiraKey = findJiraKey(pull.title, pull.body, pull.branch);

    const thin = isThinDescription(pull.body);
    const useFallback = thin && !linkedIssue && !planSpecRef;

    let commitMessages: string[] = [];
    if (useFallback) {
      const commits = await this.repo.getPrCommits(pull.id);
      commitMessages = commits.map((c) => c.message);
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider as Provider);

    const titleText = `Title: ${pull.title}`;
    const descriptionText = `Description: ${pull.body && pull.body.trim().length > 0 ? pull.body : '(empty)'}`;
    const ticketText = jiraKey ? `Referenced ticket key (context only, not fetched): ${jiraKey}` : undefined;
    const linkedIssueText = linkedIssue
      ? `Linked issue #${linkedIssue.number}: ${linkedIssue.title}\n${linkedIssue.body ?? ''}`
      : undefined;
    const planSpecText = planSpecContent
      ? `Referenced plan/spec (${planSpecRef?.path}):\n${planSpecContent}`
      : planSpecRef?.url
        ? `Referenced plan/spec URL (cited only — NOT fetched, do not fabricate its content): ${planSpecRef.url}`
        : undefined;
    // Always part of the input (not just the thin-description fallback path):
    // file paths + structural hunk headers ONLY — never hunk body lines, so
    // the cheap/less-trusted classifier model never sees full change content.
    const hunkHeadersText = formatHunkHeaders(diff);
    const changedFilesSection = hunkHeadersText
      ? `Changed files (path, +add/-del, hunk headers — no change bodies):\n${hunkHeadersText}`
      : undefined;
    const fallbackText = useFallback
      ? [
          'No direct signal available (thin/empty description, no linked issue, no plan/spec reference).',
          'Additional indirect signals:',
          `Branch: ${pull.branch}`,
          `Commit messages: ${commitMessages.slice(0, 20).join(' | ') || '(none)'}`,
          `Diff stat: +${pull.additions}/-${pull.deletions} across ${pull.filesCount} file(s)`,
        ].join('\n')
      : undefined;

    const inputSections = [
      titleText,
      descriptionText,
      ticketText,
      linkedIssueText,
      planSpecText,
      changedFilesSection,
      fallbackText,
    ].filter((s): s is string => s !== undefined);

    const systemPrompt =
      'You derive a pull request\'s intent and scope before it is reviewed by another model. ' +
      'Produce a short, structured summary: what the PR does (`intent`), and concrete `in_scope` / ' +
      '`out_of_scope` bullet points. Set `confidence` to "high" only when a direct signal (a ' +
      'substantive description, a linked issue, or a resolved plan/spec) was available; set it to ' +
      '"low" whenever you had to synthesize from indirect signals (commit messages, branch name, diff ' +
      'stat) because no direct signal was available, or the direct signal was itself too thin to be ' +
      'conclusive. Set `source` to whichever signal category actually drove your answer ("description", ' +
      '"linked_issue", "plan_spec", or "inferred" for the indirect-signals case). ' +
      'IMPORTANT: an external plan/spec URL, if present, is given to you as a CITATION ONLY — it was ' +
      'never fetched. Never invent or assume its contents; just note it was referenced. Keep the ' +
      'whole output compact — this is a classification, not a report.';

    const result = await llm.completeStructured<Intent>({
      model,
      schema: Intent,
      schemaName: 'Intent',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inputSections.join('\n\n') },
      ],
    });

    const data: Intent = {
      ...result.data,
      plan_ref: planSpecRef?.path ?? planSpecRef?.url ?? result.data.plan_ref ?? null,
    };

    await this.repo.upsertIntent(pull.id, data, {
      providerUsed: provider,
      modelUsed: model,
      headSha: pull.headSha,
    });

    // Safe, content-free sizing metadata for the classifier's own prompt —
    // mirrors reviewer-core's `assemblePrompt` sections, never the text itself.
    const sections: PromptSectionMeta[] = [
      sectionMeta('system', 'agent-config', systemPrompt),
      sectionMeta('title', 'pr-title', titleText),
      sectionMeta('description', 'pr-body', descriptionText),
      sectionMeta('ticket-key', 'jira-regex', ticketText),
      sectionMeta('linked-issue', 'github-issue', linkedIssueText),
      sectionMeta('plan-spec', 'plan-spec-resolver', planSpecText),
      sectionMeta('changed-files', 'diff-hunk-headers', changedFilesSection),
      sectionMeta('fallback-signals', 'indirect-signals', fallbackText),
    ].filter((s): s is PromptSectionMeta => s !== undefined);

    return {
      intent: data,
      providerUsed: provider,
      modelUsed: model,
      stats: {
        duration_ms: Date.now() - start,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      },
      sections,
    };
  }
}
