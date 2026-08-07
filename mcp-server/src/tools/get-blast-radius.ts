import { z } from 'zod';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_blast_radius` — NOT YET IMPLEMENTED. A firm, user-decided stub: no
 * `/blast` route or module exists yet (`repo_intel` only has a facade method,
 * `server/src/modules/repo-intel/types.ts:147`), and this plan does not add
 * one. Takes `pr_id` alone (same id as `run_agent_on_pr`/`get_findings`) —
 * validated via `GET /pulls/:id` first, so a bad `pr_id` surfaces a specific
 * "not found" error instead of masking the mistake behind the generic stub
 * message.
 */

export const getBlastRadiusInputSchema = {
  pr_id: z.string().trim().min(1),
};

export interface GetBlastRadiusInput {
  pr_id: string;
}

const STUB_MESSAGE =
  "Blast Radius is not implemented yet — it's a planned feature (see README.md's course roadmap, L04). repo_intel already has getBlastRadius() as a facade method (server/src/modules/repo-intel/types.ts:147), but no /blast route or module exists yet. This tool will start working once that lands; no action to retry here.";

export function createGetBlastRadiusTool(http: HttpClient = httpClient) {
  return {
    name: 'get_blast_radius',
    config: {
      title: 'Get Blast Radius',
      description:
        "NOT YET IMPLEMENTED — this tool always returns an error. Planned to analyze which files/callers/endpoints are impacted by a PR's changes (blast radius), given pr_id alone (same id as run_agent_on_pr/get_findings). pr_id is still validated first, so an unknown pr_id gets a specific 'not found' error, not this generic one. Do not call this expecting a real result yet — use get_findings or get_conventions for currently available analysis.",
      inputSchema: getBlastRadiusInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ pr_id }: GetBlastRadiusInput) => {
      try {
        await http.get(`/pulls/${pr_id}`);
        // Resolution succeeded — still no real feature behind this tool.
        return toToolErrorResult(new Error(STUB_MESSAGE));
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          return toToolErrorResult(
            new Error(
              `PR '${pr_id}' not found — copy pr_id from the DevDigest studio URL (check for stray whitespace).`,
            ),
          );
        }
        return toToolErrorResult(err);
      }
    },
  };
}
