/* hooks/project-context.ts — React Query hooks for SPEC-01 (Project Context):
   repo discovery, used by the Context tab (Agent editor), the SkillDrawer's
   "Project context to use" section, and the /repos/:repoId/context page. */
"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { api } from "../api";
import type { ProjectContextDoc } from "@devdigest/shared";

/** Every discovered `.md` document under specs/docs/insights for a repo
 *  (AC-1, AC-2), with its server-computed category and direct-attachment
 *  usage count. `[]` (not an error) when the repo has no clone yet (AC-3). */
export function useRepoContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["repo-context-docs", repoId],
    queryFn: () => api.get<ProjectContextDoc[]>(`/repos/${repoId}/context/docs`),
    enabled: !!repoId,
  });
}

/** Full text of one discovered document — backs the "Preview" action
 *  (AC-4). Only fetched when `path` is set (e.g. a Preview modal is open),
 *  never eagerly for the whole discovery table. */
export function useContextDocContent(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["repo-context-doc-content", repoId, path],
    queryFn: () =>
      api.get<{ content: string }>(
        `/repos/${repoId}/context/docs/content?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/**
 * Client-local mirror of `server/src/modules/reviews/constants.ts`'s
 * `MAX_CONTEXT_DOCS_TOTAL_CHARS` — client can't import server source, so this
 * is a deliberately duplicated literal (same spirit as the accepted dual-
 * contract-copy pattern) used ONLY for the UI's "approaching the budget"
 * warning visual, never enforced client-side (the server is the source of
 * truth for the actual cap). Keep in sync by hand if the server value changes.
 */
export const CLIENT_CONTEXT_BUDGET_CHARS_WARNING = 24000;

/**
 * Discovery data (incl. `chars`) for a SET of repos at once — AC-5 requires
 * the aggregate token estimate "regardless of repo", i.e. over every
 * currently-attached doc across every repo it came from, not just the one
 * repo currently selected in the picker's repo-selector. `useQueries` shares
 * its cache with `useRepoContextDocs`'s single-repo queries (same query key
 * shape), so viewing a repo in the picker never double-fetches.
 */
export function useContextDocsCharsMap(repoIds: string[]): Map<string, number> {
  const results = useQueries({
    queries: repoIds.map((repoId) => ({
      queryKey: ["repo-context-docs", repoId],
      queryFn: () => api.get<ProjectContextDoc[]>(`/repos/${repoId}/context/docs`),
    })),
  });
  const map = new Map<string, number>();
  for (let i = 0; i < repoIds.length; i++) {
    const repoId = repoIds[i];
    const docs = results[i]?.data;
    if (!repoId || !docs) continue;
    for (const d of docs) map.set(`${repoId}:${d.path}`, d.chars);
  }
  return map;
}

/** `ceil(chars/4)` — the same fallback heuristic used everywhere outside
 *  `repo-intel` (`reviewer-core/src/prompt.ts`), for the live token estimate
 *  shown while attaching documents (AC-5). */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
