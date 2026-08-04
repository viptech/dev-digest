import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from './classifier.js';
import { SPLIT_THRESHOLD_LINES } from './classification-rules.js';
import type { FindingRow, PrFileRow, SmartDiffRepo } from './repository.js';

/**
 * Smart Diff service. Deterministically combines two already-persisted
 * sources — `pr_files` and the latest review's `findings` — into the
 * `SmartDiff` contract. NEVER calls an LLM: no `resolveFeatureModel`, no
 * `container.llm(...)` import anywhere in this module (grep-verifiable —
 * see the plan's acceptance criterion).
 */

const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

export class SmartDiffService {
  constructor(private repo: SmartDiffRepo) {}

  async build(prId: string): Promise<SmartDiff> {
    const files = await this.repo.getPrFiles(prId);
    // Best-effort join, mirroring `getIntent(...).catch(() => undefined)`
    // (pulls/routes.ts:222): a review's findings are joined in when they
    // exist, but a lookup failure never fails the whole Smart Diff response.
    const findings = await this.repo.latestReviewFindings(prId).catch(() => [] as FindingRow[]);
    return assembleSmartDiff(files, findings);
  }
}

/** Pure assembly — no I/O, unit-testable with plain fixture arrays. */
export function assembleSmartDiff(files: PrFileRow[], findings: FindingRow[]): SmartDiff {
  const findingLinesByFile = new Map<string, number[]>();
  for (const f of findings) {
    const lines = findingLinesByFile.get(f.file) ?? [];
    lines.push(f.startLine);
    findingLinesByFile.set(f.file, lines);
  }
  for (const lines of findingLinesByFile.values()) lines.sort((a, b) => a - b);

  const filesByRole = new Map<SmartDiffRole, SmartDiffFile[]>(ROLE_ORDER.map((r) => [r, []]));
  let totalLines = 0;
  for (const file of files) {
    const role = classifyFile(file.path);
    totalLines += file.additions + file.deletions;
    filesByRole.get(role)!.push({
      path: file.path,
      // Deliberately always null — no LLM-summarization step in this plan's
      // scope (see Constraints in .claude/plans/smart-diff.md). Never fabricate.
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesByFile.get(file.path) ?? [],
    });
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.map((role) => ({ role, files: filesByRole.get(role)! })).filter(
    (g) => g.files.length > 0,
  );

  const tooBig = totalLines > SPLIT_THRESHOLD_LINES;
  // Deterministic, intentionally simple split heuristic (no dependency-aware
  // clustering — out of scope per the plan): one proposed split per
  // non-boilerplate group, only surfaced once the PR is flagged too big.
  const proposedSplits = tooBig
    ? groups.filter((g) => g.role !== 'boilerplate').map((g) => ({ name: g.role, files: g.files.map((f) => f.path) }))
    : [];

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  };
}
