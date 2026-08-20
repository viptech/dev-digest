"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalExpectation, EvalRun, EvalRunRecord, EvalSetRunResult } from "@devdigest/shared";

/** `GET /agents/:id/evals` returns a superset of EvalCase with the latest
 *  run's summary attached — a route-level response shape, not part of the
 *  shared contract (avoids the client/server dual-copy drift risk). */
export interface EvalCaseWithLastRun extends EvalCase {
  // actual_count mirrors server/src/modules/evals/service.ts's
  // EvalCaseWithLastRun by hand (dual-copy DTO convention, root INSIGHTS.md
  // 2026-07-31) — kept in sync, not shared, per Development Plan
  // evals-tab-mockup-alignment.md.
  last_run: { pass: boolean; recall: number; ran_at: string; actual_count: number } | null;
}

/** Every eval hook below is `ownerKind`-parameterized (Development Plan
 *  `skill-editor.md` Step 5, SPEC-06 T8/AC-17) — `'agent'` routes through
 *  `/agents/:id/...`, `'skill'` through `/skills/:id/...` (the skill-owned
 *  routes SPEC-06 Steps 1-4 already added server-side). Query keys carry the
 *  `ownerKind` dimension so an agent's and a skill's caches never collide
 *  even if they briefly shared a numeric-looking id. */
export interface EvalOwner {
  ownerKind: "agent" | "skill";
  ownerId: string;
}

function ownerBasePath({ ownerKind, ownerId }: EvalOwner): string {
  return ownerKind === "skill" ? `/skills/${ownerId}` : `/agents/${ownerId}`;
}

function evalsQueryKey({ ownerKind, ownerId }: EvalOwner) {
  return ["evals", ownerKind, ownerId] as const;
}

function evalRunsQueryKey({ ownerKind, ownerId }: EvalOwner) {
  return ["eval-runs", ownerKind, ownerId] as const;
}

export function useEvalCases(owner: EvalOwner) {
  return useQuery({
    queryKey: evalsQueryKey(owner),
    queryFn: () => api.get<EvalCaseWithLastRun[]>(`${ownerBasePath(owner)}/evals`),
    enabled: !!owner.ownerId,
  });
}

export interface EvalCaseInput {
  name: string;
  input_diff?: string;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string;
}

export function useCreateEvalCase(owner: EvalOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>(`${ownerBasePath(owner)}/evals`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalsQueryKey(owner) }),
  });
}

export function useUpdateEvalCase(owner: EvalOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.put<EvalCase>(`${ownerBasePath(owner)}/evals/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalsQueryKey(owner) }),
  });
}

export function useDeleteEvalCase(owner: EvalOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`${ownerBasePath(owner)}/evals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalsQueryKey(owner) }),
  });
}

export function useRunEvalCase(owner: EvalOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<{ case: EvalCase; run: EvalRun }>(`${ownerBasePath(owner)}/evals/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalsQueryKey(owner) }),
  });
}

/** SPEC-05 T13 (corrected AC-1) — an unsaved draft built from one
 *  accepted/dismissed finding: `owner_id`/`expected_output`/`input_diff` are
 *  pre-filled, but nothing is persisted yet (no `id`). The caller opens this
 *  in `EvalCaseModal`, which persists it (via the existing
 *  `useCreateEvalCase`) only on Save/Run case. */
export interface EvalCaseDraft {
  owner_id: string;
  name: string;
  input_diff: string;
  input_meta: unknown;
  expected_output: EvalExpectation[];
}

/** Builds the draft (server does the work — finding/review/PR resolution +
 *  diff reconstruction); no cache invalidation here since nothing was
 *  written yet. */
export function useCreateEvalCaseFromFinding() {
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCaseDraft>(`/findings/${findingId}/eval-case`),
  });
}

/** SPEC-05 AC-17 — set-run history for an owner (each row = one case's run
 *  within a bulk set-run; group client-side by `run_group_id`). */
export function useEvalRunHistory(owner: EvalOwner) {
  return useQuery({
    queryKey: evalRunsQueryKey(owner),
    queryFn: () => api.get<EvalRunRecord[]>(`${ownerBasePath(owner)}/eval-runs`),
    enabled: !!owner.ownerId,
  });
}

/** SPEC-05 AC-11/AC-12 — bulk "Run all": runs every case in the owner's set,
 *  returns the aggregate + per-case results under one `run_group_id`. */
export function useRunEvalSet(owner: EvalOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSetRunResult>(`${ownerBasePath(owner)}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalsQueryKey(owner) });
      qc.invalidateQueries({ queryKey: evalRunsQueryKey(owner) });
    },
  });
}

/** SPEC-05 T14 — one historical set-run shown on the Eval Dashboard.
 *  `version` is a per-agent ORDINAL COUNTER over that agent's own set-runs
 *  by `ran_at` ascending (1 = the agent's oldest set-run) — unrelated to the
 *  agent config-versioning concept elsewhere in the app. Manually kept in
 *  sync with the server's `EvalDashboardRunSummary`
 *  (`server/src/modules/evals/service.ts`) — NOT a shared zod contract, same
 *  dual-copy convention as `EvalCaseWithLastRun` above (root INSIGHTS.md
 *  2026-07-31). */
export interface EvalDashboardRunSummary {
  run_group_id: string;
  version: number;
  ran_at: string;
  cases_total: number;
  cases_passed: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/** SPEC-05 AC-20/AC-21, T14 — workspace-wide Eval Dashboard: every agent
 *  with its cases count and its full set-run history (`recent_runs`,
 *  newest-first, capped at 10). `last_run` is `recent_runs[0] ?? null`
 *  ("Never run"). */
export interface EvalDashboardAgentSummary {
  agent_id: string;
  agent_name: string;
  agent_model: string;
  cases_total: number;
  recent_runs: EvalDashboardRunSummary[];
  last_run: EvalDashboardRunSummary | null;
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalDashboardAgentSummary[]>(`/eval-dashboard`),
  });
}

/** SPEC-05 T14 — "Run all agents" on the Eval Dashboard: a client-side loop
 *  over the EXISTING per-agent `POST /agents/:id/eval-runs` endpoint (no new
 *  bulk-of-bulk server route). Uses `Promise.allSettled` so one agent's
 *  failure (e.g. an empty case set → 422, AC-13) never blocks the rest —
 *  same per-agent spirit as AC-14's per-case failure isolation. Returns the
 *  count of agents that failed, so the caller can surface a partial-failure
 *  message without needing per-agent error detail. */
export function useRunAllAgentEvalSets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentIds: string[]) => {
      const results = await Promise.allSettled(
        agentIds.map((id) => api.post<EvalSetRunResult>(`/agents/${id}/eval-runs`)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: agentIds.length, failed };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-dashboard"] }),
  });
}
