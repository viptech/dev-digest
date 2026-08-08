import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefSnapshot } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/prReview.json";

let mockBrief: PrBriefSnapshot | undefined;

vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => ({ data: mockBrief }),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  mockBrief = undefined;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function brief(overrides: Partial<PrBriefSnapshot["review_rollup"]> = {}): PrBriefSnapshot {
  return {
    review_rollup: {
      verdict: "request_changes",
      score: 61,
      findings_summary: {
        counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
        items: [
          {
            id: "f1",
            severity: "CRITICAL",
            category: "security",
            title: "Stripe secret key committed in plaintext",
            file: "src/config.ts",
            start_line: 12,
            end_line: 12,
            confidence: 0.95,
            rationale: "A live key is committed in source.",
          },
        ],
      },
      blockers_count: 2,
      summary:
        "Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.",
      cost_usd: 0.014,
      tokens_in: 8200,
      tokens_out: 1300,
      ...overrides,
    },
  };
}

describe("PrBriefCard", () => {
  it("renders verdict, score, per-severity findings badges (same as the PR list), summary, and cost/tokens from the rollup", () => {
    mockBrief = brief();
    renderWithIntl(<PrBriefCard prId="pr-1" />);

    expect(screen.getByText(/Stripe secret key is committed in plaintext/)).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText(/\$0\.014/)).toBeInTheDocument();
    expect(screen.getByTestId("pr-findings-badge-CRITICAL")).toHaveTextContent("1");
    expect(screen.getByTestId("pr-findings-badge-WARNING")).toHaveTextContent("1");
    expect(screen.getByTestId("pr-findings-badge-SUGGESTION")).toHaveTextContent("1");
  });

  it("renders nothing when the PR has never been reviewed (review_rollup is null)", () => {
    mockBrief = { review_rollup: null };
    const { container } = render(<PrBriefCard prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the query has no data yet", () => {
    mockBrief = undefined;
    const { container } = render(<PrBriefCard prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
