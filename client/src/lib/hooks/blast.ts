/* hooks/blast.ts — Blast Radius tab data hook. Not a "review" concept (no
   findings/verdict), so it lives on its own rather than in hooks/reviews.ts. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/** Which symbols in this PR's changed files were declared, who calls/imports
   them, and which HTTP endpoints/crons might be affected — computed
   server-side from the persistent repo-intel index, no LLM call. Exact
   template match to `useSmartDiff` (hooks/reviews.ts). */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
