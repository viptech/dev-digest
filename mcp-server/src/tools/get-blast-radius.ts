import { z } from 'zod';
import { ChangedSymbol, DownstreamImpact, BlastDegradedReason } from '@devdigest/shared';
import type { BlastRadius } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_blast_radius` — read-only. Takes `pr_id` alone (same id as
 * `run_agent_on_pr`/`get_findings`) — validated via `GET /pulls/:id` first,
 * so a bad `pr_id` surfaces a specific "not found" error rather than a raw
 * status leak, then `GET /pulls/:id/blast` for the real result.
 *
 * Reports which symbols this PR's changed files declared, which files
 * call/import them (with file:line), and which HTTP endpoints/cron jobs
 * might be affected — computed from the repo's persistent repo-intel index,
 * never an LLM call. `degraded`/`reason` (when present) mean the index is
 * incomplete (still building, disabled, or too large) — the result is still
 * returned, just possibly undercounted; never silently empty.
 */

export const getBlastRadiusInputSchema = {
  pr_id: z.string().trim().min(1),
};

export interface GetBlastRadiusInput {
  pr_id: string;
}

export const getBlastRadiusOutputSchema = {
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
};

export function notFoundMessage(prId: string): string {
  return `PR '${prId}' not found — copy pr_id from the DevDigest studio URL (check for stray whitespace).`;
}

export function createGetBlastRadiusTool(http: HttpClient = httpClient) {
  return {
    name: 'get_blast_radius',
    config: {
      title: 'Get Blast Radius',
      description:
        "Fetch the blast radius for a pull request, by pr_id (the same id used for run_agent_on_pr/get_findings). Reports changed_symbols (declared in this PR's changed files), downstream (each changed symbol's callers with file:line, plus endpoints_affected/crons_affected), and a deterministic summary string — computed from the repo's persistent code index, no LLM call. degraded/reason (when present) mean the index is incomplete — the result is still returned, never silently empty.",
      inputSchema: getBlastRadiusInputSchema,
      outputSchema: getBlastRadiusOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ pr_id }: GetBlastRadiusInput) => {
      try {
        await http.get(`/pulls/${pr_id}`);
        const blast = await http.get<BlastRadius>(`/pulls/${pr_id}/blast`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(blast) }],
          structuredContent: blast,
        };
      } catch (err) {
        // 404 = pr_id doesn't exist. 422 = the server's route param schema
        // rejected pr_id outright because it isn't UUID-shaped (`IdParams`,
        // server/_shared/schemas.ts) — from the caller's point of view
        // that's just as much "nothing here" as a 404.
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          return toToolErrorResult(new Error(notFoundMessage(pr_id)));
        }
        return toToolErrorResult(err);
      }
    },
  };
}
