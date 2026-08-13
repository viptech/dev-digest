import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBriefSnapshot } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/prReview.json";

// Mocked at the network boundary (`@/lib/api`), same precedent
// `CreateSkillFromConventionsModal.test.tsx` uses — the REAL `useBrief`/
// `useGenerateBrief` hooks run, so the M3 merge logic in hooks/brief.ts is
// actually exercised, not just assumed covered by brief.test.ts's own unit
// coverage of the hook in isolation.
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

function renderCard(prId = "pr-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
          <PrBriefCard prId={prId} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

const rollup: NonNullable<PrBriefSnapshot["review_rollup"]> = {
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
};

const populatedBrief: NonNullable<PrBriefSnapshot["brief"]> = {
  what: "Adds a rate limiter middleware to the login and password-reset endpoints.",
  why: "Repeated unauthenticated login attempts were not throttled, enabling brute-force attacks.",
  risk_level: "medium",
  risks: [],
  review_focus: [],
};

describe("PrBriefCard", () => {
  it("renders nothing while the query has no data yet", () => {
    apiGet.mockReturnValue(new Promise(() => {})); // never resolves — still loading
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the VerdictBanner rollup when reviews exist, alongside the Why+Risk empty-state CTA", async () => {
    apiGet.mockResolvedValue({ review_rollup: rollup, brief: null, brief_generated_at: null });
    renderCard();

    expect(await screen.findByText("61")).toBeInTheDocument();
    expect(screen.getByText("No brief yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeInTheDocument();
  });

  it("still renders the Why+Risk empty-state CTA when the PR has never been reviewed (review_rollup: null) — B1 regression", async () => {
    apiGet.mockResolvedValue({ review_rollup: null, brief: null, brief_generated_at: null });
    renderCard();

    expect(await screen.findByText("No brief yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeInTheDocument();
    // No VerdictBanner content when there is no review.
    expect(screen.queryByText("61")).not.toBeInTheDocument();
  });

  it("clicking Generate brief posts to /pulls/:id/brief and renders the populated risk-level badge + what/why text", async () => {
    apiGet.mockResolvedValue({ review_rollup: null, brief: null, brief_generated_at: null });
    apiPost.mockResolvedValue({
      review_rollup: null,
      brief: populatedBrief,
      brief_generated_at: "2026-08-13T00:00:00.000Z",
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /generate brief/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/pulls/pr-1/brief"));
    expect(await screen.findByText(populatedBrief.what)).toBeInTheDocument();
    expect(screen.getByText(populatedBrief.why)).toBeInTheDocument();
    const badge = screen.getByText(/medium risk/i);
    expect(badge).toHaveStyle({ color: "var(--warn)" });
  });

  it("a degraded response with no prior brief shows a retry message, not a blank card", async () => {
    apiGet.mockResolvedValue({ review_rollup: null, brief: null, brief_generated_at: null });
    apiPost.mockResolvedValue({
      review_rollup: null,
      brief: null,
      brief_generated_at: null,
      brief_degraded: true,
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText("Couldn't generate a brief right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeInTheDocument();
  });

  it("a degraded Regenerate merges with a previously cached brief — keeps showing the old what/why plus a refresh-failed notice (M3)", async () => {
    apiGet.mockResolvedValue({
      review_rollup: null,
      brief: populatedBrief,
      brief_generated_at: "2026-08-13T00:00:00.000Z",
    });
    apiPost.mockResolvedValue({
      review_rollup: null,
      brief: null,
      brief_generated_at: null,
      brief_degraded: true,
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /regenerate/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/pulls/pr-1/brief"));
    // Old brief content is still visible — never blanked by the degraded reply.
    expect(await screen.findByText(populatedBrief.what)).toBeInTheDocument();
    expect(screen.getByText(populatedBrief.why)).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });
});
