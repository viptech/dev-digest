import { z } from 'zod';
import { PrStatus } from '@devdigest/shared';
import type { PrMeta } from '@devdigest/shared';
import { httpClient, ApiError } from '../http-client.js';
import type { HttpClient } from '../http-client.js';
import { toToolErrorResult } from '../errors.js';

/**
 * `list_pulls` — read-only. Calls `GET /repos/:id/pulls`, by `repo_id` (copy
 * from the DevDigest studio URL). This is the one gap the course's deliberate
 * "no list_prs" call (README.md/04-hands-on-lab.md:22 — `gh`/GitHub MCP
 * already cover it) leaves open in practice: `gh`/GitHub MCP only know
 * GitHub's own PR identity (owner/repo#number), never DevDigest's internal
 * `pr_id` — the id every other tool here (`run_agent_on_pr`, `get_findings`,
 * `get_blast_radius`) actually needs. Without this, getting that id requires
 * a human to open the Studio UI first. Kept deliberately thin: no filtering
 * by title/author, just the repo's PR list with each PR's `pr_id` + status.
 *
 * `status` is NOT GitHub's raw merge state — for still-open PRs it's
 * DevDigest's derived review-freshness status (`needs_review` / `reviewed` /
 * `stale`); only merged/closed PRs keep GitHub's literal state (see
 * server/src/modules/pulls/status.ts's `deriveReviewStatus` doc comment).
 * `open_only` filters out `merged`/`closed`, keeping every "still open on
 * GitHub" PR regardless of its review-freshness bucket.
 */

export const listPullsInputSchema = {
  repo_id: z.string().trim().min(1),
  open_only: z.boolean().optional(),
};

export interface ListPullsInput {
  repo_id: string;
  open_only?: boolean;
}

const PrSummary = z.object({
  pr_id: z.string(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type PrSummary = z.infer<typeof PrSummary>;

export const listPullsOutputSchema = {
  pulls: z.array(PrSummary),
  total: z.number().int(),
};

function toPrSummary(pr: PrMeta & { id: string }): PrSummary {
  return {
    pr_id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    status: pr.status,
    opened_at: pr.opened_at ?? null,
    updated_at: pr.updated_at ?? null,
  };
}

export function createListPullsTool(http: HttpClient = httpClient) {
  return {
    name: 'list_pulls',
    config: {
      title: 'List Pulls',
      description:
        "List pull requests for a repo, by repo_id (copy from the DevDigest studio URL). Returns each PR's pr_id (needed for run_agent_on_pr/get_findings/get_blast_radius), number, title, author, branch, status, and timestamps. status is DevDigest's own review-freshness state for still-open PRs (needs_review/reviewed/stale), or GitHub's literal merged/closed for finished ones. Set open_only:true to drop merged/closed PRs and keep only ones still open on GitHub. Read-only.",
      inputSchema: listPullsInputSchema,
      outputSchema: listPullsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    handler: async ({ repo_id, open_only }: ListPullsInput) => {
      try {
        const all = await http.get<(PrMeta & { id: string })[]>(`/repos/${repo_id}/pulls`);
        const filtered = open_only ? all.filter((pr) => pr.status !== 'merged' && pr.status !== 'closed') : all;
        const pulls = filtered.map(toPrSummary);
        const output = { pulls, total: pulls.length };
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
