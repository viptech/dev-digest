"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalRun } from "@devdigest/shared";

export function useEvalCases(agentId: string) {
  return useQuery({
    queryKey: ["evals", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/evals`),
    enabled: !!agentId,
  });
}

export interface EvalCaseInput {
  name: string;
  input_diff?: string;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string;
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>(`/agents/${agentId}/evals`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", agentId] }),
  });
}

export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.put<EvalCase>(`/evals/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", agentId] }),
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/evals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", agentId] }),
  });
}

export function useRunEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<{ case: EvalCase; run: EvalRun }>(`/agents/${agentId}/evals/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", agentId] }),
  });
}
