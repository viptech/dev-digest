import { z } from 'zod';
import { ConventionCandidate } from '@devdigest/shared';
import type { Repo } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `get_conventions` — read-only. Takes `repo_id` directly (copied from the
 * DevDigest studio URL) and reads already-extracted candidates via
 * `GET /repos/:id/conventions`. Never triggers extraction
 * (`POST /repos/:repoId/conventions/extract`).
 *
 * `repo_id` is trimmed before use: a stray leading/trailing space from a
 * copy-paste out of the URL bar silently breaks the lookup otherwise (the id
 * itself no longer matches any repo — surfaces as a generic "not found").
 *
 * `ConventionsService.list()` doesn't validate repo existence (no dedicated
 * `GET /repos/:id` route exists either) — a well-formed but unknown
 * `repo_id` would otherwise return an empty list indistinguishable from "no
 * conventions extracted yet". Listing `/repos` once and checking `repo_id`
 * is among them keeps the "unknown input → forward-leading error" guarantee
 * the other tools have.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const getConventionsInputSchema = {
  repo_id: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
};

export const getConventionsOutputSchema = {
  conventions: z.array(ConventionCandidate),
  total: z.number().int(),
  truncated: z.boolean(),
};

export interface GetConventionsInput {
  repo_id: string;
  limit?: number;
}

export function createGetConventionsTool(http: HttpClient = httpClient) {
  return {
    name: 'get_conventions',
    config: {
      title: 'Get Conventions',
      description:
        "Fetch already-extracted coding conventions for a repo, by repo_id (copy from the DevDigest studio URL — leading/trailing whitespace is trimmed automatically, but paste the raw id) — naming, error-handling, testing rules the team actually follows, each with file/line evidence and a confidence score. Read-only: does not trigger new extraction, only returns existing candidates. Optional limit caps the list (default 50, max 200).",
      inputSchema: getConventionsInputSchema,
      outputSchema: getConventionsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ repo_id, limit }: GetConventionsInput) => {
      try {
        const repos = await http.get<Repo[]>('/repos');
        if (!repos.some((r) => r.id === repo_id)) {
          return toToolErrorResult(
            new Error(
              `Repo '${repo_id}' not found among connected repos — copy repo_id from the DevDigest studio URL (check for stray whitespace).`,
            ),
          );
        }

        const all = await http.get<ConventionCandidate[]>(`/repos/${repo_id}/conventions`);
        const cap = limit ?? DEFAULT_LIMIT;
        const total = all.length;
        const truncated = total > cap;
        const output = { conventions: all.slice(0, cap), total, truncated };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          return toToolErrorResult(
            new Error(
              `Repo '${repo_id}' not found — copy repo_id from the DevDigest studio URL (check for stray whitespace).`,
            ),
          );
        }
        return toToolErrorResult(err);
      }
    },
  };
}
