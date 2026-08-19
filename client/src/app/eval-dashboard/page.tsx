import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval-dashboard (Eval Dashboard, SPEC-05 T9). Workspace-wide — no
   :repoId token. Thin route entry — the view, styles and i18n are colocated
   under _components/EvalDashboardView. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
