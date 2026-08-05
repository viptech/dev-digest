/**
 * PR title search — builds the ILIKE pattern for `GET /repos/:id/pulls/search`.
 * Split out from routes.ts so the pattern-building logic has its own unit
 * surface (routes.ts stays HTTP-only).
 */

/** Wrap a free-text query into a substring ILIKE pattern. */
export function buildSearchPattern(query: string): string {
  return `%${query.trim()}%`;
}
