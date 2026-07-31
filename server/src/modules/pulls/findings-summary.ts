import type { FindingsSummary } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';

/** Aggregate one review's findings into the PR-list FINDINGS column summary. */
export function buildFindingsSummary(findings: FindingRow[]): FindingsSummary {
  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    const sev = f.severity as keyof typeof counts;
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  const items = findings.map((f) => ({
    id: f.id,
    severity: f.severity as FindingsSummary['items'][number]['severity'],
    category: f.category as FindingsSummary['items'][number]['category'],
    title: f.title,
    file: f.file,
    start_line: f.startLine,
    end_line: f.endLine,
    confidence: f.confidence,
    rationale: f.rationale,
  }));
  return { counts, items };
}
