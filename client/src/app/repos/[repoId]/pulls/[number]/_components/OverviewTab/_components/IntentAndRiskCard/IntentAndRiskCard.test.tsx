import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { PrIntentRecord, Risk } from "@devdigest/shared";

vi.mock("@/lib/hooks/reviews", () => ({
  useRefreshIntent: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { IntentAndRiskCard } from "./IntentAndRiskCard";

afterEach(cleanup);

function intent(overrides: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: "pr-1",
    intent: "Add rate limiting to public API endpoints to prevent abuse.",
    in_scope: ["Add middleware for rate limiting"],
    out_of_scope: ["Authentication changes"],
    confidence: "high",
    source: "description",
    plan_ref: null,
    ...overrides,
  };
}

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: "security",
    title: "Stripe secret key committed in plaintext",
    explanation: "A live sk_live_ key is committed to src/config.ts.",
    severity: "high",
    file_refs: ["src/config.ts"],
    ...overrides,
  };
}

describe("IntentAndRiskCard", () => {
  it("renders intent text unchanged from before this feature (no risks)", () => {
    render(<IntentAndRiskCard intent={intent()} prId="pr-1" />);
    expect(screen.getByText(/Add rate limiting to public API endpoints/)).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
  });

  it("intent={null} with a non-empty risks renders ONLY the risk chips, no intent/scope block, no crash — M4 regression", () => {
    render(<IntentAndRiskCard intent={null} risks={[risk()]} prId="pr-1" />);
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText("Stripe secret key committed in plaintext")).toBeInTheDocument();
  });

  it("renders a risk chip closed by default — title + first file_ref visible, explanation hidden", () => {
    render(<IntentAndRiskCard intent={null} risks={[risk()]} prId="pr-1" />);
    expect(screen.getByText("Stripe secret key committed in plaintext")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.queryByText(/A live sk_live_ key/)).not.toBeInTheDocument();
  });

  it("clicking the chevron reveals the risk's explanation", () => {
    render(<IntentAndRiskCard intent={null} risks={[risk()]} prId="pr-1" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/A live sk_live_ key/)).toBeInTheDocument();
  });

  it("both intent={null} and empty risks renders nothing at all", () => {
    const { container } = render(<IntentAndRiskCard intent={null} risks={[]} prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
