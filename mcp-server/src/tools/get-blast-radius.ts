import { z } from 'zod';
import { httpClient } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { resolveRepo, resolvePull } from '../resolvers.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_blast_radius` — NOT YET IMPLEMENTED. A firm, user-decided stub: no
 * `/blast` route or module exists yet (`repo_intel` only has a facade method,
 * `server/src/modules/repo-intel/types.ts:147`), and this plan does not add
 * one. Pure MCP-side stub — zero HTTP calls of its own; `repo`/`pr` are still
 * resolved first so a bad repo/PR number surfaces a specific "not found"
 * error instead of masking the mistake behind the generic stub message.
 */

export const getBlastRadiusInputSchema = {
  repo: z.string().min(1),
  pr: z.number().int(),
};

export interface GetBlastRadiusInput {
  repo: string;
  pr: number;
}

const STUB_MESSAGE =
  "Blast Radius is not implemented yet — it's a planned feature (see README.md's course roadmap, L04). repo_intel already has getBlastRadius() as a facade method (server/src/modules/repo-intel/types.ts:147), but no /blast route or module exists yet. This tool will start working once that lands; no action to retry here.";

export function createGetBlastRadiusTool(http: HttpClient = httpClient) {
  return {
    name: 'get_blast_radius',
    config: {
      title: 'Get Blast Radius',
      description:
        "NOT YET IMPLEMENTED — this tool always returns an error. Planned to analyze which files/callers/endpoints are impacted by a PR's changes (blast radius), but the feature isn't built yet. repo and pr are still validated first, so a bad repo/PR number gets a specific 'not found' error, not this generic one. Do not call this expecting a real result yet — use get_findings or get_conventions for currently available analysis.",
      inputSchema: getBlastRadiusInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ repo, pr }: GetBlastRadiusInput) => {
      try {
        const repoRow = await resolveRepo(http, repo);
        await resolvePull(http, repoRow.id, pr, repo);
        // Resolution succeeded — still no real feature behind this tool.
        return toToolErrorResult(new Error(STUB_MESSAGE));
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  };
}
