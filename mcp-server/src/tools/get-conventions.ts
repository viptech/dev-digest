import { z } from 'zod';
import { ConventionCandidate } from '@devdigest/shared';
import { httpClient } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { resolveRepo } from '../resolvers.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_conventions` — read-only. Never triggers extraction
 * (`POST /repos/:repoId/conventions/extract`), only reads already-extracted
 * candidates via `GET /repos/:id/conventions` (Gap 3 in the plan: no server
 * change needed, the route already returns the full `ConventionCandidate`
 * shape).
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const getConventionsInputSchema = {
  repo: z.string().min(1),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
};

export const getConventionsOutputSchema = {
  conventions: z.array(ConventionCandidate),
  total: z.number().int(),
  truncated: z.boolean(),
};

export interface GetConventionsInput {
  repo: string;
  limit?: number;
}

export function createGetConventionsTool(http: HttpClient = httpClient) {
  return {
    name: 'get_conventions',
    config: {
      title: 'Get Conventions',
      description:
        "Fetch already-extracted coding conventions for a repo ('owner/name') — naming, error-handling, testing rules the team actually follows, each with file/line evidence and a confidence score. Read-only: does not trigger new extraction, only returns existing candidates. Optional limit caps the list (default 50, max 200).",
      inputSchema: getConventionsInputSchema,
      outputSchema: getConventionsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ repo, limit }: GetConventionsInput) => {
      try {
        const repoRow = await resolveRepo(http, repo);
        const all = await http.get<ConventionCandidate[]>(`/repos/${repoRow.id}/conventions`);
        const cap = limit ?? DEFAULT_LIMIT;
        const total = all.length;
        const truncated = total > cap;
        const output = { conventions: all.slice(0, cap), total, truncated };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        // Covers both ResolutionError (repo not found) and ApiError (upstream
        // failure) — both already carry a forward-leading `.message`.
        return toToolErrorResult(err);
      }
    },
  };
}
