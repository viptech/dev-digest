import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function makeFinding(overrides: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const FINDINGS: FindingRecord[] = [makeFinding({})];

const MIXED_FINDINGS: FindingRecord[] = [
  makeFinding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
  makeFinding({ id: "f2", severity: "WARNING", title: "Missing Retry-After header" }),
  makeFinding({ id: "f3", severity: "WARNING", title: "Unbounded query" }),
  makeFinding({ id: "f4", severity: "SUGGESTION", title: "Extract helper" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel severity filter", () => {
  it("shows a count per severity chip", () => {
    renderWithIntl(<FindingsPanel findings={MIXED_FINDINGS} prId="pr1" />);
    expect(screen.getByRole("button", { name: /CRITICAL\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /WARNING\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SUGGESTION\s*1/ })).toBeInTheDocument();
  });

  it("filters to a single severity on click", () => {
    renderWithIntl(<FindingsPanel findings={MIXED_FINDINGS} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Missing Retry-After header")).not.toBeInTheDocument();
    expect(screen.queryByText("Extract helper")).not.toBeInTheDocument();
  });

  it("shows the union of two selected severities", () => {
    renderWithIntl(<FindingsPanel findings={MIXED_FINDINGS} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));
    fireEvent.click(screen.getByRole("button", { name: /WARNING/ }));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Missing Retry-After header")).toBeInTheDocument();
    expect(screen.getByText("Unbounded query")).toBeInTheDocument();
    expect(screen.queryByText("Extract helper")).not.toBeInTheDocument();
  });

  it("clicking an active chip again clears its filter", () => {
    renderWithIntl(<FindingsPanel findings={MIXED_FINDINGS} prId="pr1" />);

    const criticalChip = screen.getByRole("button", { name: /CRITICAL/ });
    fireEvent.click(criticalChip);
    fireEvent.click(criticalChip);

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Missing Retry-After header")).toBeInTheDocument();
    expect(screen.getByText("Extract helper")).toBeInTheDocument();
  });
});
