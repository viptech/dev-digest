/** Narrow no-break space — thousands separator for token counts. */
const THIN_SPACE = " ";

/**
 * USD cost, 2 significant figures with a floor of 2 decimal places
 * (0.06 → "$0.06", 0.0135 → "$0.014", 0.00128 → "$0.0013", 1.5 → "$1.50").
 * `null`/`undefined` (no data) renders "—"; an actual zero-cost run (a free
 * model) renders "$0.00" — the two must stay visually distinct.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  // Round via multiply/Math.round rather than toPrecision(): binary floats
  // don't represent decimals like 0.0135 exactly (it's really
  // 0.013499999999999999…), so toPrecision(2) rounds it down to "0.013"
  // instead of the "0.014" a human typing that number would expect.
  const magnitude = Math.floor(Math.log10(Math.abs(usd)));
  const scale = 10 ** (1 - magnitude);
  const rounded = Math.round(usd * scale) / scale;
  const decimals = Math.max(2, (rounded.toString().split(".")[1] ?? "").length);
  return `$${rounded.toFixed(decimals)}`;
}

/** Combined in+out token count, thousands-grouped (e.g. "9 119"). */
export function formatTokenTotal(tokensIn: number, tokensOut: number): string {
  return (tokensIn + tokensOut).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

/** Token in→out pair in K (e.g. "8.2K→1.3K"). */
export function formatTokenPair(tokensIn: number, tokensOut: number): string {
  const k = (n: number) => `${(n / 1000).toFixed(1)}K`;
  return `${k(tokensIn)}→${k(tokensOut)}`;
}
