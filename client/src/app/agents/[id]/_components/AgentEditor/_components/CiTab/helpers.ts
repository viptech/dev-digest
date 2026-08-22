import type { CiRun } from "@devdigest/shared";

/** `CiRun.status` is a plain `z.string()` at the wire (not a strict enum in
 *  the DTO — see `eval-ci.ts`'s `CiRun`), but the only values `CiService`
 *  ever actually writes are `CiRunStatus`'s four. Maps to the `ci.runs.status.*`
 *  i18n keys, falling back to the raw value for anything unexpected instead
 *  of throwing. */
const STATUS_I18N_KEY: Record<string, string> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};

export function statusI18nKey(status: string | null): string {
  if (!status) return "succeeded";
  return STATUS_I18N_KEY[status] ?? status;
}

/** Compact severity breakdown for the FINDINGS column (AC-28) — "—" when
 *  there are zero findings, else "{n}C {n}W {n}S" for whichever severities
 *  are non-zero (falls back to the plain total when the breakdown columns
 *  are all null, e.g. a row ingested before AC-3's migration added them). */
export function findingsSummary(run: CiRun): string {
  const total = run.findings_count ?? 0;
  if (total === 0) return "—";
  const parts: string[] = [];
  if (run.critical) parts.push(`${run.critical}C`);
  if (run.warning) parts.push(`${run.warning}W`);
  if (run.suggestion) parts.push(`${run.suggestion}S`);
  return parts.length > 0 ? parts.join(" ") : String(total);
}
