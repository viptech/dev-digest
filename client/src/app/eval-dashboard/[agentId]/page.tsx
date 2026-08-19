"use client";

import { useParams } from "next/navigation";
import { EvalAgentDashboardView } from "./_components/EvalAgentDashboardView";

/* Route: /eval-dashboard/:agentId — per-agent Eval Dashboard drill-down
   (SPEC-05 T15). Thin route entry — the view, styles and helpers are
   colocated under _components/EvalAgentDashboardView. The workspace-level
   `/eval-dashboard` card click now lands here instead of `/agents/:id?tab=evals`
   (T14's page is unchanged otherwise; that tab remains a separate,
   independent path to the same underlying data). */
export default function EvalAgentDashboardPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <EvalAgentDashboardView agentId={agentId} />;
}
