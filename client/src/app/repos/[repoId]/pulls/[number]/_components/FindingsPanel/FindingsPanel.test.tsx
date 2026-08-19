import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
// FindingCard (rendered by FindingsPanel) now calls
// useCreateEvalCaseFromFinding(), which needs a real QueryClientProvider in
// the tree — same precedent as PrBriefCard.test.tsx.
const evalCaseDraftMutateAsync = vi.fn().mockResolvedValue({
  owner_id: "ag1",
  name: "From finding: Hardcoded secret",
  input_diff: "",
  input_meta: null,
  expected_output: [{ type: "must_find", file: "src/config.ts", start_line: 11, end_line: 11 }],
});
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: evalCaseDraftMutateAsync, isPending: false }),
}));
// SPEC-05 T13 — FindingsPanel is the lift point that renders the shared
// EvalCaseModal for whichever FindingCard's draft is open; stub it here
// (RTL: test FindingsPanel's own wiring, not EvalCaseModal's internals,
// which has its own dedicated test suite at
// client/src/components/eval-case-modal/EvalCaseModal.test.tsx).
vi.mock("@/components/eval-case-modal", () => ({
  EvalCaseModal: ({ agentId, seededFrom, onClose }: { agentId: string; seededFrom: string; onClose: () => void }) => (
    <div data-testid="eval-case-modal-stub" onClick={onClose}>
      {`modal for ${agentId} (${seededFrom})`}
    </div>
  ),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  evalCaseDraftMutateAsync.mockClear();
});

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

describe("FindingsPanel — eval-case draft lift point (SPEC-05 T13)", () => {
  it("opens the shared EvalCaseModal with the fetched draft after 'Turn into eval case'", async () => {
    const accepted = [makeFinding({ id: "f1", accepted_at: "2026-08-19T00:00:00.000Z" })];
    renderWithIntl(<FindingsPanel findings={accepted} prId="pr1" />);

    expect(screen.queryByTestId("eval-case-modal-stub")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Turn into eval case"));

    await waitFor(() => expect(evalCaseDraftMutateAsync).toHaveBeenCalledWith("f1"));
    await waitFor(() =>
      expect(screen.getByTestId("eval-case-modal-stub")).toHaveTextContent("modal for ag1 (accepted)"),
    );
  });

  it("closes the modal via its onClose callback", async () => {
    const accepted = [makeFinding({ id: "f1", accepted_at: "2026-08-19T00:00:00.000Z" })];
    renderWithIntl(<FindingsPanel findings={accepted} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    await waitFor(() => expect(screen.getByTestId("eval-case-modal-stub")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("eval-case-modal-stub"));
    expect(screen.queryByTestId("eval-case-modal-stub")).not.toBeInTheDocument();
  });
});
