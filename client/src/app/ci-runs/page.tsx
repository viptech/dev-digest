import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (CI Runs, SPEC-08 T14). Workspace-wide — no :repoId/:id
   token. Thin route entry — the view, styles, helpers and i18n are
   colocated under _components/CiRunsView. */
export default function CiRunsPage() {
  return <CiRunsView />;
}
