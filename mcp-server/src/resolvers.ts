/**
 * Client-side resolution of the flat scalar args ("owner/name" repo, PR
 * number, agent name) the 5 tools take, into the internal UUIDs the API's
 * routes actually need. No dedicated server-side lookup route exists for any
 * of these (confirmed — see the plan's "Technical gaps investigated and
 * resolved", Gap 1 and Open Question 3), so each resolver lists the
 * relevant collection once and matches client-side.
 */

import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { HttpClient } from './http-client.js';

/** Thrown when a repo/PR/agent can't be resolved from the caller's input.
 * Always carries a forward-leading message (what to check/call next) —
 * tool handlers catch this and pass it straight to `toToolErrorResult`. */
export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** Resolve `"owner/name"` to its `Repo` row via `GET /repos` + a client-side,
 * case-insensitive match on `full_name`. Cached per call only (no cross-call
 * cache — see the plan's Gap 1 resolution: repos rarely change mid-session
 * and staleness would be worse than one extra GET). */
export async function resolveRepo(http: HttpClient, repoFullName: string): Promise<Repo> {
  const repos = await http.get<Repo[]>('/repos');
  const needle = repoFullName.toLowerCase();
  const match = repos.find((r) => r.full_name.toLowerCase() === needle);
  if (!match) {
    throw new ResolutionError(
      `Repo '${repoFullName}' not found among connected repos — double-check it was added in the DevDigest UI first (this tool set has no repos-listing tool to verify against).`,
    );
  }
  return match;
}

/** Resolve a GitHub PR number to its internal pull UUID via
 * `GET /repos/:id/pulls` + a match on `number`. `repoFullName` is only used
 * to phrase the not-found message. */
export async function resolvePull(
  http: HttpClient,
  repoId: string,
  prNumber: number,
  repoFullName: string,
): Promise<PrMeta & { id: string }> {
  const pulls = await http.get<PrMeta[]>(`/repos/${repoId}/pulls`);
  const match = pulls.find((p) => p.number === prNumber);
  if (!match) {
    throw new ResolutionError(
      `PR #${prNumber} not found in repo ${repoFullName} — it may not be imported yet.`,
    );
  }
  if (!match.id) {
    // PrMeta.id is nullish in the contract (platform.ts) — in practice this
    // means the PR's metadata hasn't fully synced yet, not a caller mistake.
    throw new ResolutionError(
      `PR #${prNumber} in repo ${repoFullName} has no internal id yet (metadata not fully synced) — try again shortly.`,
    );
  }
  return match as PrMeta & { id: string };
}

/** Resolve an agent name to its `Agent` row via `GET /agents` + a
 * case-insensitive, exact match on `name` (the `Agent` contract has no
 * `slug` field — see the plan's Open Question 3 / Decision 3). On a miss,
 * offers a "did you mean" substring hint before falling back to pointing at
 * `list_agents`. */
export async function resolveAgent(http: HttpClient, agentName: string): Promise<Agent> {
  const agents = await http.get<Agent[]>('/agents');
  const needle = agentName.toLowerCase();
  const exact = agents.find((a) => a.name.toLowerCase() === needle);
  if (exact) return exact;

  const suggestions = agents.filter((a) => a.name.toLowerCase().includes(needle));
  const hint =
    suggestions.length > 0 ? ` Did you mean: ${suggestions.map((a) => a.name).join(', ')}?` : '';
  throw new ResolutionError(`Agent '${agentName}' not found, call list_agents to see available agents.${hint}`);
}
