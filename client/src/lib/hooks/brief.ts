/* hooks/brief.ts — PR Brief data hook. Not a "review" concept, lives on its
   own rather than in hooks/reviews.ts (same rationale hooks/blast.ts already
   documents for itself). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefSnapshot } from "@devdigest/shared";

/** The Overview tab's top "PR Brief" card data — the deterministic
    verdict/score/blockers/cost rollup from the PR's latest review, plus
    (SPEC-04) the LLM-generated `brief` (what/why/risk_level/risks/
    review_focus), if any has been generated and is still fresh relative to
    the PR's current `head_sha`. Exact template match to `useBlastRadius`
    (hooks/blast.ts). */
export function useBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<PrBriefSnapshot>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * Generate (or regenerate) the LLM `brief` → `POST /pulls/:id/brief`. Same
 * `PrBriefSnapshot` shape as `GET`, so a successful response can seed the
 * `["brief", prId]` cache directly (no follow-up `GET`) — same precedent
 * `useRefreshIntent` uses for `["intent", prId]` (hooks/reviews.ts).
 *
 * A degraded response (`brief: null, brief_degraded: true` — AC-13, never
 * persisted server-side) must NEVER erase a previously-good cached brief
 * (cross-model review finding M3): a full `setQueryData(key, data)`
 * replacement would overwrite `brief` with `null` on every failed
 * Regenerate, making a working card go blank. Merge instead — keep the OLD
 * `brief`/`brief_generated_at` when the new response is degraded AND
 * carries no brief of its own; always take the new `review_rollup`/
 * `brief_degraded` as-is (both are cheap, always-fresh reads independent of
 * the LLM call's outcome). When there was no prior cached brief to fall
 * back to, the degraded response is written as-is — nothing to preserve.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefSnapshot>(`/pulls/${prId}/brief`),
    onSuccess: (data) => {
      qc.setQueryData<PrBriefSnapshot | undefined>(["brief", prId], (old) =>
        data.brief_degraded && data.brief === null && old?.brief
          ? { ...data, brief: old.brief, brief_generated_at: old.brief_generated_at }
          : data,
      );
    },
  });
}
