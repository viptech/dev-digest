/**
 * Naive line-level text diff (SPEC-05 T15, explicit non-goal: no Myers-diff
 * quality, no new npm dependency — `client` has neither `diff` nor
 * `jsdiff`). Promoted here (Development Plan `skill-editor.md` Step 9,
 * SPEC-06 AC-29) from `client/src/app/eval-dashboard/[agentId]/_components/
 * CompareRunsModal/helpers.ts` — the Versions tab's version-body diff is a
 * second caller from a different feature tree (react-ui-architecture
 * "promote on the second user"), and this utility was never eval-specific
 * (deliberately NOT placed in `lib/eval-runs.ts`).
 */

export interface PromptDiffLine {
  text: string;
  status: "removed" | "added" | "unchanged";
}

/**
 * Heuristic: a line present only in `oldText` is "removed", a line present
 * only in `newText` is "added", a line present in both is "unchanged"
 * (rendered from `newText`'s ordering). Callers should not invoke this with
 * a `null` side — check for that first and render a "not captured"/similar
 * message instead (this function itself just treats `null` as an empty
 * string, so it never throws).
 */
export function diffPromptLines(oldText: string | null, newText: string | null): PromptDiffLine[] {
  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const lines: PromptDiffLine[] = [];
  for (const line of oldLines) {
    if (!newSet.has(line)) lines.push({ text: line, status: "removed" });
  }
  for (const line of newLines) {
    lines.push({ text: line, status: oldSet.has(line) ? "unchanged" : "added" });
  }
  return lines;
}
