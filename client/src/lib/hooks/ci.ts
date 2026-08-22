/* hooks/ci.ts — React Query hooks for the Export-to-CI wizard + the agent
   editor's CI tab (SPEC-08). `useExportCi`/`useAgentCi` are this file's half
   (Group 4 — ExportWizard + CiTab); `useCiRuns`/`useRefreshCi` (the global
   /ci-runs page's half) are added alongside by a later, separate change —
   this file is additive, don't remove these two when extending it. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiFailOn, CiInstallation, CiRun } from "@devdigest/shared";

/** `GET /agents/:id/ci` response shape (server: `ci/service.ts`'s
 *  `AgentCiView` — no dedicated Zod contract, this read isn't
 *  request-validated; mirrors the server-side TS interface 1:1). */
export interface AgentCiView {
  installations: CiInstallation[];
  ci_fail_on: CiFailOn;
  runs: CiRun[];
}

/** This agent's CI installations + read-only `ci_fail_on` + its own run
 *  history (Agent editor's CI tab, AC-31/AC-32/AC-33). */
export function useAgentCi(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-ci", agentId],
    queryFn: () => api.get<AgentCiView>(`/agents/${agentId}/ci`),
    enabled: !!agentId,
  });
}

/**
 * `POST /agents/:id/export-ci` — both the Preview (`action: 'files'`, no
 * side effects) and Install (`action: 'open_pr'`) paths of the Export
 * Wizard share this one mutation; the caller picks the path via `action` in
 * the input. Only a real Install persists a `ci_installations` row — the
 * Preview path's response carries the `id: 'preview'` sentinel
 * (`server/src/modules/ci/service.ts`'s `previewInstallation`), so the
 * agent's CI-tab cache is only invalidated for a real install.
 */
export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (data) => {
      if (data.installation.id !== "preview") {
        qc.invalidateQueries({ queryKey: ["agent-ci", agentId] });
      }
    },
  });
}

/** `GET /ci/runs` response — the run list + the DISTINCT-repo list for the
 *  "All repos" filter (AC-30), returned together so the client never needs
 *  a second round-trip just to populate that dropdown. */
export interface CiRunsView {
  runs: CiRun[];
  repos: string[];
}

/** Filters `GET /ci/runs` accepts (server: `ci/routes.ts`'s `ListCiRunsQuery`)
 *  — camelCase here, mapped to snake_case query params at the fetch call
 *  per the wire-contract convention. Every field is optional; an absent
 *  field is simply omitted from the query string, not sent as `""`. */
export interface CiRunsFilters {
  since?: string;
  agentId?: string;
  repo?: string;
  status?: string;
  source?: string;
}

function ciRunsQueryString(filters: CiRunsFilters): string {
  const params = new URLSearchParams();
  if (filters.since) params.set("since", filters.since);
  if (filters.agentId) params.set("agent_id", filters.agentId);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Workspace-wide CI run history for the global `/ci-runs` page (AC-27/
 *  AC-28/AC-30). Filters are plain query params — no client-side
 *  post-filtering, the server does the `WHERE`. `refetchInterval` backs the
 *  page's client-side "auto-refresh" toggle (T14) — `false` (the default)
 *  disables polling entirely, matching every other query hook in this file. */
export function useCiRuns(filters: CiRunsFilters, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => api.get<CiRunsView>(`/ci/runs${ciRunsQueryString(filters)}`),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/**
 * `POST /ci/refresh` — triggers the pull-model ingest cycle for every
 * installation in the workspace (AC-24). Backs the CI Runs page's manual
 * "Refresh" button (T14) — the page's separate "auto-refresh" toggle does
 * NOT call this on a timer; it sets `refetchInterval` on `useCiRuns`
 * itself instead, re-reading whatever's already been ingested rather than
 * re-triggering a GitHub-calling ingest cycle from every open tab (keeps
 * `POST /ci/refresh`'s AC-34 rate limit, 10/min, meaningful across
 * multiple simultaneously-open CI Runs pages). Invalidates `ci-runs` on
 * success so the table reflects whatever this manual trigger just
 * inserted.
 */
export function useRefreshCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ inserted: number }>("/ci/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
