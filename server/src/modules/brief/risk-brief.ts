import type { Brief, Provider, StructuredResult } from '@devdigest/shared';
import { Brief as BriefSchema } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD, formatIntentForPrompt } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../reviews/repository.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffRepository } from '../smart-diff/repository.js';
import {
  MAX_BRIEF_DESCRIPTION_CHARS,
  MAX_BRIEF_ISSUE_BODY_CHARS,
  MAX_BRIEF_SPECS_CHARS,
  MAX_BRIEF_INTENT_CHARS,
  MAX_DIFF_STAT_FILES,
  MAX_BRIEF_INPUT_TOKENS,
} from './constants.js';

/** Minimal structured logger (pino-compatible) — mirrors onboarding/
 *  service.ts's Logger. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export interface BriefInputs {
  userMessage: string;
  /** AC-5's grounding "known universe": the FULL, untruncated `pr_files.path`
   *  set unioned with the FULL `BlastRadius.downstream[].endpoints_affected`
   *  — deliberately independent of whatever `MAX_DIFF_STAT_FILES` truncated
   *  out of the rendered prompt (the same trap cross-model review caught in
   *  SPEC-03's onboarding plan). */
  knownFileRefsUniverse: Set<string>;
  /** AC-6's grounding "known universe": the FULL `pr_files.path` set alone
   *  (endpoints excluded per the spec's own explicit AC-6 text). */
  changedPaths: Set<string>;
}

/**
 * Collect AC-1's five deterministic input categories and render the user
 * message for the ONE `callBrief` LLM call. `systemPromptTemplate` is the
 * ALREADY-RENDERED `risk-brief.system.md` text (no guard yet) — passed in so
 * the AC-2 budget check below can account for the fixed system-prompt+guard
 * overhead without this function owning prompt-template rendering itself
 * (`callBrief` owns rendering-for-sending; this function only measures).
 *
 * Reaches GitHub/repo-intel/project-context/LLM ONLY through `Container`-
 * resolved ports, never a concrete adapter — per `onion-architecture`.
 */
export async function assembleBriefInput(
  container: Container,
  pull: PullRow,
  repoRow: { id: string; owner: string; name: string },
  systemPromptTemplate: string,
  logger?: Logger,
): Promise<BriefInputs> {
  // ---- (a) Intent — omitted entirely when the PR has no persisted
  // classification yet (Intent is not a hard precondition, per the spec's
  // Edge cases). LLM-derived from untrusted PR text, so it is wrapped like
  // any other untrusted section (cross-model review finding M1). ----
  const persistedIntent = await container.reviewRepo.getIntent(pull.id);
  const intentSection = persistedIntent
    ? wrapUntrusted('intent', formatIntentForPrompt(persistedIntent).slice(0, MAX_BRIEF_INTENT_CHARS))
    : undefined;

  // ---- (b) Blast summary — live call, never cached (same as the Blast
  // Radius card itself). `summary` is repo-derived structural prose, wrapped
  // per M1; `endpoints_affected` feeds the AC-5 grounding universe only, and
  // stays unwrapped there (see (c) below for why). ----
  const blast = await new BlastService(container, new SmartDiffRepository(container.db)).build(
    pull.id,
    pull.repoId,
  );
  const blastSection = wrapUntrusted('blast', blast.summary);
  const endpointsAffected = new Set<string>();
  for (const d of blast.downstream) {
    for (const e of d.endpoints_affected) endpointsAffected.add(e.trim());
  }

  // ---- (c) Diff stats — aggregate always included, never capped; a FULL,
  // unbounded `getPrFiles` call feeds `changedPaths`/`knownFileRefsUniverse`
  // (the grounding universe is never truncated), but the rendered PROMPT
  // file list is capped to MAX_DIFF_STAT_FILES (sorted by churn desc), with
  // a trailing "+N more files" line when truncated. `pr_files.patch` is
  // NEVER read here — only {path, additions, deletions}. ----
  const allFiles = await new SmartDiffRepository(container.db).getPrFiles(pull.id);
  const changedPaths = new Set<string>(allFiles.map((f) => f.path.trim()));
  const knownFileRefsUniverse = new Set<string>([...changedPaths, ...endpointsAffected]);

  const sortedFiles = [...allFiles].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );
  const listedFiles = sortedFiles.slice(0, MAX_DIFF_STAT_FILES);
  const remainingCount = sortedFiles.length - listedFiles.length;
  const diffStatsLines = [
    'DIFF STATS:',
    `- aggregate: +${pull.additions}/-${pull.deletions} across ${pull.filesCount} file(s)`,
    'CHANGED FILES:',
    ...listedFiles.map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`),
    ...(remainingCount > 0 ? [`- ... +${remainingCount} more files (aggregate only)`] : []),
  ];
  if (endpointsAffected.size > 0) {
    diffStatsLines.push('ENDPOINTS:', ...[...endpointsAffected].map((e) => `- ${e}`));
  }
  const diffStatsSection = diffStatsLines.join('\n');

  // ---- (d) Linked issue — same best-effort pattern as
  // `intent-service.ts:164-171`: a missing token / offline mode degrades to
  // "no linked issue" rather than failing the whole Brief generation. ----
  let linkedIssueSection: string | undefined;
  try {
    const gh = await container.github();
    const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pull.number);
    if (detail.linked_issue) {
      const { title, body } = detail.linked_issue;
      const text = `Linked issue #${detail.linked_issue.number}: ${title}\n${(body ?? '').slice(0, MAX_BRIEF_ISSUE_BODY_CHARS)}`;
      linkedIssueSection = wrapUntrusted('linked-issue', text);
    }
  } catch (err) {
    logger?.debug({ err }, 'risk-brief: linked issue lookup skipped');
  }

  // ---- (e) Relevant specs — resolved via the `agentId` of the PR's latest
  // `kind==='review'` row. Skipped entirely when either no review exists yet
  // OR the found review's `agentId` is `null` (cross-model review finding
  // M6 — `resolveAgentContext(null)` is not a call this module defines
  // behavior for). ----
  const specsSections: string[] = [];
  try {
    const reviews = await container.reviewRepo.reviewsForPull(pull.id);
    const latestReview = reviews.find(({ review }) => review.kind === 'review');
    if (latestReview?.review.agentId) {
      const docs = await container.projectContext.resolveAgentContext(latestReview.review.agentId);
      let budgetRemaining = MAX_BRIEF_SPECS_CHARS;
      for (let i = 0; i < docs.length && budgetRemaining > 0; i++) {
        const doc = docs[i]!;
        const files = await container.repoIntel.readFiles(doc.repoId, [doc.path]);
        const content = files[0]?.content;
        if (!content) continue;
        const chunk = content.slice(0, budgetRemaining);
        budgetRemaining -= chunk.length;
        specsSections.push(wrapUntrusted(`spec-${i}`, chunk));
      }
    }
  } catch (err) {
    logger?.debug({ err }, 'risk-brief: relevant specs resolution skipped');
  }

  const descriptionSection = wrapUntrusted(
    'pr-description',
    `Title: ${pull.title}\nDescription: ${pull.body && pull.body.trim().length > 0 ? pull.body.slice(0, MAX_BRIEF_DESCRIPTION_CHARS) : '(empty)'}`,
  );

  const sections = [
    descriptionSection,
    intentSection,
    blastSection,
    diffStatsSection,
    linkedIssueSection,
    ...specsSections,
  ].filter((s): s is string => s !== undefined);

  let userMessage = sections.join('\n\n');

  // ---- Defensive total-budget check (AC-2, cross-model review finding M2)
  // — INCLUDING the system prompt + guard, per AC-2's own "включно з
  // системним промптом" text, not userMessage.length alone. ----
  const totalChars = systemPromptTemplate.length + 2 + INJECTION_GUARD.length + userMessage.length;
  if (Math.ceil(totalChars / 4) > MAX_BRIEF_INPUT_TOKENS) {
    // Drop the "relevant specs" section first — least essential, most likely
    // culprit given its own 8000-char sub-pool.
    const withoutSpecs = [descriptionSection, intentSection, blastSection, diffStatsSection, linkedIssueSection]
      .filter((s): s is string => s !== undefined)
      .join('\n\n');
    userMessage = withoutSpecs;
    const recomputed = systemPromptTemplate.length + 2 + INJECTION_GUARD.length + userMessage.length;
    if (Math.ceil(recomputed / 4) > MAX_BRIEF_INPUT_TOKENS) {
      logger?.warn({ prId: pull.id, chars: recomputed }, 'risk-brief: still over budget after dropping specs');
    }
  }

  return { userMessage, knownFileRefsUniverse, changedPaths };
}

/**
 * `systemPrompt` is the rendered template WITHOUT the guard — this function
 * appends `INJECTION_GUARD` itself (the ONE place that does — Constraints,
 * cross-model review finding B5) immediately before sending. Throws on
 * failure — the caller (`service.ts`) catches for AC-13.
 */
export async function callBrief(
  container: Container,
  args: { provider: Provider; model: string; systemPrompt: string; userMessage: string },
): Promise<StructuredResult<Brief>> {
  const llm = await container.llm(args.provider);
  return llm.completeStructured<Brief>({
    model: args.model,
    schema: BriefSchema,
    schemaName: 'Brief',
    messages: [
      { role: 'system', content: `${args.systemPrompt}\n\n${INJECTION_GUARD}` },
      { role: 'user', content: args.userMessage },
    ],
  });
}
