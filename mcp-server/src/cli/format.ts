import type { Finding } from '@devdigest/shared';

/** Pure — no I/O. Terminal exit-code contract: see review-working.ts's doc comment. */
export const EXIT_CLEAN = 0;
export const EXIT_BLOCKING_FINDINGS = 1;
export const EXIT_COULD_NOT_RUN = 2;

/** A "blocking" finding = any CRITICAL-severity one — the one severity level
 *  that's unambiguous and needs no per-agent `ci_fail_on` policy lookup
 *  (unlike the web UI's per-run `blockers` count, which is gated by the
 *  reviewing agent's own configured threshold). */
export function determineExitCode(findings: Finding[]): number {
  return findings.some((f) => f.severity === 'CRITICAL') ? EXIT_BLOCKING_FINDINGS : EXIT_CLEAN;
}

function severityRank(sev: Finding['severity']): number {
  return sev === 'CRITICAL' ? 3 : sev === 'WARNING' ? 2 : 1;
}

function formatLocation(f: Finding): string {
  return f.end_line !== f.start_line ? `${f.file}:${f.start_line}-${f.end_line}` : `${f.file}:${f.start_line}`;
}

/** Findings sorted worst-first, one `[SEVERITY] file:line — title` + rationale
 *  block each. Returns a plain string (no direct stdout write) so it's
 *  trivially snapshot-testable. */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No findings.\n';
  const sorted = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return sorted.map((f) => `[${f.severity}] ${formatLocation(f)} — ${f.title}\n  ${f.rationale}\n`).join('');
}
