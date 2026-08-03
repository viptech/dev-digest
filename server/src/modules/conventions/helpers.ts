import { z } from 'zod';
import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

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

/** Step 1 — the model picks which sampled files are worth reading in full. */
export const ConventionFileSelectionSchema = z.object({
  files: z.array(z.string()).describe('Repo-relative paths worth reading for conventions, chosen from the candidate list.'),
});
export type ConventionFileSelection = z.infer<typeof ConventionFileSelectionSchema>;

/** Step 2 — extracted rule candidates with file evidence. */
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
export type ConventionExtraction = z.infer<typeof ConventionExtractionSchema>;
