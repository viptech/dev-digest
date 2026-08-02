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
