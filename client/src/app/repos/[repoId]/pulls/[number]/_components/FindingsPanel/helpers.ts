import type { FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence and non-selected-severity findings, sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  activeSeverities: ReadonlySet<string> = new Set(),
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (activeSeverities.size > 0) shown = shown.filter((f) => activeSeverities.has(f.severity));
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
