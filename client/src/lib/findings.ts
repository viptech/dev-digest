import type { FindingRecord } from "@devdigest/shared";

/** Count findings per severity level. */
export function severityCounts(findings: FindingRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}
