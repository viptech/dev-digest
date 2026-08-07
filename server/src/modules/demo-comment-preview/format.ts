/**
 * Shared helper used by the L04 Blast Radius demo: intentionally called from
 * two unrelated service files plus directly from an HTTP endpoint, so a
 * follow-up change to this function has a real, multi-file blast radius.
 */
export function truncateText(input: string, max: number, ellipsis = '…'): string {
  return input.length > max ? `${input.slice(0, max - ellipsis.length)}${ellipsis}` : input;
}
