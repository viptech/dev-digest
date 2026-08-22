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
