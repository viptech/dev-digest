/**
 * T6 — findings clustering (pure function, no DB/repo/container import; see
 * `onion-architecture` skill's "reusable across the reviewer pipeline" shape).
 * Groups findings from possibly-different agents that likely refer to the
 * same code location, so a "where agents disagree" view can compare them.
 *
 * Two findings cluster when `file` matches literally AND their
 * `[start_line, end_line]` ranges overlap or are within ±2 lines of each
 * other (AC-18: `category`/`severity` never affect clustering). Every
 * original finding is retained with its agent attribution — never deduped or
 * mutated (AC-19, AC-20).
 */
import type { FindingRow } from '../../db/rows.js';

export interface ClusteredFinding {
  finding: FindingRow;
  agentId: string | null;
  agentName: string | null;
}

export interface FindingCluster {
  file: string;
  start_line: number;
  end_line: number;
  findings: ClusteredFinding[];
}

const PROXIMITY_LINES = 2;

/**
 * Clusters findings by (file, overlapping-or-±2-lines range). AC-18 defines a
 * *pairwise* adjacency relation ("two findings cluster when..."); a cluster is
 * a connected component of that relation, not just "whatever the next item
 * happens to fall next to." Starts with one singleton cluster per finding,
 * then repeatedly merges any two clusters whose running [min,max] ranges are
 * adjacent, to a fixed point — so a chain (e.g. lines 10, 12, 14, each pair
 * ±2 apart) always ends up as one cluster regardless of input order. This
 * matters because findings arrive from concurrently-executing agents (T5) —
 * their relative order is not guaranteed line-sorted, and a coordinator
 * review caught the single-pass "merge into the first existing cluster that
 * fits" version silently producing a different (wrong) split depending on
 * that order — e.g. items ordered [14, 10, 12] left finding 10 stranded in
 * its own cluster instead of joining 12/14's, because clusters were never
 * merged with each other, only grown one new item at a time. Typical finding
 * counts per grouped run are small, so the fixed-point re-scan is cheap (see
 * the spec's own NFR on clustering cost).
 */
export function clusterFindings(items: ClusteredFinding[]): FindingCluster[] {
  type WorkingCluster = { file: string; minStart: number; maxEnd: number; findings: ClusteredFinding[] };

  let clusters: WorkingCluster[] = items.map((item) => ({
    file: item.finding.file,
    minStart: item.finding.startLine,
    maxEnd: item.finding.endLine,
    findings: [item],
  }));

  const adjacent = (a: WorkingCluster, b: WorkingCluster) =>
    a.file === b.file && a.minStart <= b.maxEnd + PROXIMITY_LINES && a.maxEnd >= b.minStart - PROXIMITY_LINES;

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < clusters.length && !mergedAny; i++) {
      const ci = clusters[i];
      if (!ci) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        const cj = clusters[j];
        if (!cj || !adjacent(ci, cj)) continue;
        clusters[i] = {
          file: ci.file,
          minStart: Math.min(ci.minStart, cj.minStart),
          maxEnd: Math.max(ci.maxEnd, cj.maxEnd),
          findings: [...ci.findings, ...cj.findings],
        };
        clusters.splice(j, 1);
        mergedAny = true;
        break;
      }
    }
  }

  return clusters.map((c) => ({
    file: c.file,
    start_line: c.minStart,
    end_line: c.maxEnd,
    findings: c.findings,
  }));
}
