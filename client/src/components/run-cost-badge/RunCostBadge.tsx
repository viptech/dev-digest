/* RunCostBadge — the $ spend of one review run (or its aggregate over a PR).
   Two views: "compact" (list column, sum only) and "detailed" (timeline /
   verdict banner, tokens + sum). Renders "—" when there's no cost data —
   never "$0.00", which would read as a free run instead of an unknown one. */
import React from "react";
import { formatUsd, formatTokenPair, formatTokenTotal } from "./helpers";

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  tokenFormat = "pair",
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "detailed";
  tokenFormat?: "pair" | "total";
}) {
  const style: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };

  if (variant === "compact") {
    return (
      <span className="mono" style={style}>
        {formatUsd(costUsd)}
      </span>
    );
  }

  const hasTokens = tokensIn != null && tokensOut != null;
  if (!hasTokens) {
    return (
      <span className="mono" style={style}>
        {formatUsd(costUsd)}
      </span>
    );
  }

  // Tokens without a matched price (model outside the price book) still show
  // the token count instead of collapsing the whole line to "—".
  if (costUsd == null) {
    return (
      <span className="mono" style={style}>
        {tokenFormat === "total"
          ? `${formatTokenTotal(tokensIn, tokensOut)} tok`
          : formatTokenPair(tokensIn, tokensOut)}
      </span>
    );
  }

  return (
    <span className="mono" style={style}>
      {tokenFormat === "total"
        ? `${formatTokenTotal(tokensIn, tokensOut)} tok · ${formatUsd(costUsd)}`
        : `${formatUsd(costUsd)} · ${formatTokenPair(tokensIn, tokensOut)}`}
    </span>
  );
}
