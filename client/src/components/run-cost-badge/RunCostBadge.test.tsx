import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";
import { formatUsd, formatTokenPair, formatTokenTotal } from "./helpers";

afterEach(cleanup);

describe("formatUsd", () => {
  it("formats to 2 significant figures with a floor of 2 decimals", () => {
    expect(formatUsd(0.06)).toBe("$0.06");
    expect(formatUsd(0.0135)).toBe("$0.014");
    expect(formatUsd(0.00128)).toBe("$0.0013");
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("renders '—' for null/undefined, never '$0.00'", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("renders an actual zero cost as '$0.00' (a free model, distinct from unknown)", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("formatTokenTotal / formatTokenPair", () => {
  it("sums in+out with thousands grouping", () => {
    expect(formatTokenTotal(8200, 919)).toBe("9 119");
  });

  it("formats in->out in K", () => {
    expect(formatTokenPair(8200, 1300)).toBe("8.2K→1.3K");
  });
});

describe("RunCostBadge", () => {
  it("compact variant shows only the sum", () => {
    render(<RunCostBadge costUsd={0.014} variant="compact" />);
    expect(screen.getByText(formatUsd(0.014))).toBeInTheDocument();
  });

  it("compact variant with no cost data shows '-'", () => {
    render(<RunCostBadge costUsd={null} variant="compact" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("detailed/pair shows '$cost x in->out'", () => {
    render(<RunCostBadge costUsd={0.014} tokensIn={8200} tokensOut={1300} variant="detailed" tokenFormat="pair" />);
    expect(
      screen.getByText(`${formatUsd(0.014)} · ${formatTokenPair(8200, 1300)}`),
    ).toBeInTheDocument();
  });

  it("detailed/total shows 'in+out tok x $cost'", () => {
    render(
      <RunCostBadge costUsd={0.0013} tokensIn={8200} tokensOut={919} variant="detailed" tokenFormat="total" />,
    );
    // Built from the same helpers (not hand-typed). testing-library normalizes
    // the DOM text's whitespace (collapsing U+202F to a plain space) but NOT
    // the matcher string, so the matcher needs the same collapse applied.
    const expected = `${formatTokenTotal(8200, 919)} tok · ${formatUsd(0.0013)}`.replace(/\s+/g, " ");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("detailed with tokens but no cost shows tokens, not '-'", () => {
    render(<RunCostBadge costUsd={null} tokensIn={100} tokensOut={50} variant="detailed" tokenFormat="pair" />);
    expect(screen.getByText(formatTokenPair(100, 50))).toBeInTheDocument();
  });
});
