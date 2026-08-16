/* hooks/onboarding.ts — React Query hooks for SPEC-03 (Onboarding Generator). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { OnboardingResponse } from "@devdigest/shared";

/**
 * The persisted tour, if any. A 404 (no tour generated yet, AC-13 — or a
 * degraded generation, which is NEVER persisted per AC-12) is treated as
 * "no tour yet" (`null`), not a query error — mirrors how
 * `project-context.ts`/`conventions.ts` handle their own not-found cases.
 */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: async (): Promise<OnboardingResponse | null> => {
      try {
        return await api.get<OnboardingResponse>(`/repos/${repoId}/onboarding`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: !!repoId,
  });
}

/**
 * Mutation → `POST /repos/:repoId/onboarding/generate`. Returns the full
 * `OnboardingResponse`, including a possible `degraded: true`. A degraded
 * result is, by design, never in the `GET` cache to invalidate INTO (the
 * server never persists it — AC-12) — only a NON-degraded success seeds the
 * `GET` cache directly, so a subsequent read doesn't need a network
 * round-trip. The page itself keeps the degraded result in local state
 * (passed via this mutation's own per-call `onSuccess`), since it's the only
 * place it will ever be visible.
 */
export function useGenerateOnboarding(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingResponse>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data) => {
      if (!data.degraded) qc.setQueryData(["onboarding", repoId], data);
      else qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
