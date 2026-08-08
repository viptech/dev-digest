/* hooks/brief.ts — PR Brief data hook. Not a "review" concept, lives on its
   own rather than in hooks/reviews.ts (same rationale hooks/blast.ts already
   documents for itself). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefSnapshot } from "@devdigest/shared";

/** The Overview tab's top "PR Brief" card data — currently just the
    deterministic verdict/score/blockers/cost rollup from the PR's latest
    review. Exact template match to `useBlastRadius` (hooks/blast.ts). */
export function useBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<PrBriefSnapshot>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}
