"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (samplingMode?: "code" | "llm") =>
      api.post<ConventionCandidate[]>(
        `/repos/${repoId}/conventions/extract`,
        samplingMode ? { sampling_mode: samplingMode } : undefined,
      ),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { rule?: string; status?: "pending" | "accepted" | "rejected" };
    }) => api.put<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
