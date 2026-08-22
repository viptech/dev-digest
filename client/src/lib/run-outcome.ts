/* run-outcome.ts — promoted out of `RunHistory.tsx` (SPEC-07 T11):
   `ColumnsView` needs the exact same run → status-badge derivation as the
   "Agent runs" tab's timeline, so a second consumer means this is no longer
   `RunHistory`-local (react-ui-architecture "promote on second user").

   The badge reflects the review OUTCOME, not just the run lifecycle: a
   finished run that found blockers reads "rejected" (red), never a green
   "done". Outcome is derived from the denormalized blocker/finding counts on
   the run row, so it matches the CI gate (deterministic) rather than the
   model's verdict. */
import type { RunSummary } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

export interface Outcome {
  key: string;
  color: string;
  bg: string;
  icon: IconName;
}

export function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): color by the deterministic outcome.
  if ((run.blockers ?? 0) > 0)
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if ((run.findings_count ?? 0) > 0)
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}
