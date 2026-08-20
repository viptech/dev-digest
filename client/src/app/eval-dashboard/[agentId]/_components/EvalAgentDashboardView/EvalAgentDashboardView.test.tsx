import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";

// AppShell pulls in repo-context/theme/shell hooks unrelated to this view.
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// CompareRunsModal has its own test file — stub it here so selecting 2 runs
// + clicking Compare is observable without pulling in useUpdateAgent, etc.
const compareModalProps = vi.fn();
vi.mock("../CompareRunsModal", () => ({
  CompareRunsModal: (props: unknown) => {
    compareModalProps(props);
    return <div data-testid="compare-modal" />;
  },
}));

let agent: unknown = { data: { id: "ag1", name: "Security Reviewer", provider: "openai", model: "gpt-4.1" }, isLoading: false, isError: false };
let historyRows: unknown[] = [];
let cases: unknown[] = [];
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => agent,
}));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalRunHistory: () => ({ data: historyRows, isLoading: false, isError: false }),
  useEvalCases: () => ({ data: cases, isLoading: false }),
}));

import { EvalAgentDashboardView } from "./EvalAgentDashboardView";

afterEach(() => {
  cleanup();
  compareModalProps.mockClear();
  agent = { data: { id: "ag1", name: "Security Reviewer", provider: "openai", model: "gpt-4.1" }, isLoading: false, isError: false };
  historyRows = [];
  cases = [];
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalAgentDashboardView agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

function runRecord(over: Record<string, unknown> = {}) {
  return {
    id: `r-${Math.random()}`,
    case_id: "c1",
    case_name: "stripe-key-leak",
    run_group_id: "g1",
    ran_at: "2026-08-01T00:00:00.000Z",
    actual_output: [],
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 100,
    cost_usd: 0.01,
    system_prompt_snapshot: "review carefully",
    ...over,
  };
}

describe("EvalAgentDashboardView", () => {
  it("renders the agent name and model badge", () => {
    renderWithIntl();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
  });

  it("renders 3 metric cards with values + a delta vs. the previous run", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", recall: 0.5, precision: 0.4, citation_accuracy: 0.3 }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z", recall: 1, precision: 0.8, citation_accuracy: 0.6 }),
    ];
    renderWithIntl();
    // Each metric label appears twice: once as a metric-card heading, once
    // as the history table's column header (same translation key, reused).
    expect(screen.getAllByText("RECALL")).toHaveLength(2);
    expect(screen.getAllByText("PRECISION")).toHaveLength(2);
    expect(screen.getAllByText("CITATION ACCURACY")).toHaveLength(2);
    // "100%" (card RECALL) also appears in the history table's newest row —
    // the card shows the same "current" value the table's top row does.
    expect(screen.getAllByText("100%")).toHaveLength(2);
    // Delta vs. the previous run: recall 50% -> 100% = +50%. The plain "50%"
    // text also appears in the history table's older row (recall 0.5) — the
    // delta's own text node includes the "▲ " arrow prefix, disambiguating it.
    expect(screen.getByText(/▲ 50%/)).toBeInTheDocument();
  });

  it("renders a sparkline per metric card", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z" }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z" }),
    ];
    const { container } = renderWithIntl();
    expect(container.querySelectorAll("svg path").length).toBeGreaterThan(0);
  });

  it("shows the insight banner when a metric dropped between the two newest runs", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", pass: true, recall: 1, precision: 1, citation_accuracy: 1 }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z", pass: false, recall: 1, precision: 0.7, citation_accuracy: 1 }),
    ];
    renderWithIntl();
    expect(screen.getByText(/Precision dipped 30pts on v2/)).toBeInTheDocument();
  });

  it("shows no banner when no metric dropped between the two newest runs", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", recall: 0.8, precision: 0.8, citation_accuracy: 0.8 }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z", recall: 0.9, precision: 0.9, citation_accuracy: 0.9 }),
    ];
    renderWithIntl();
    expect(screen.queryByText(/dipped/)).not.toBeInTheDocument();
  });

  it("Compare is disabled until exactly two runs are selected, then opens CompareRunsModal", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z" }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z" }),
    ];
    renderWithIntl();
    const compareButton = screen.getByText("Compare").closest("button")!;
    expect(compareButton).toBeDisabled();

    const checkboxes = screen.getAllByLabelText("Select to compare");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    expect(compareButton).toBeDisabled();
    fireEvent.click(checkboxes[1]!);
    expect(compareButton).not.toBeDisabled();

    fireEvent.click(compareButton);
    expect(screen.getByTestId("compare-modal")).toBeInTheDocument();
    expect(compareModalProps).toHaveBeenCalled();
  });

  it("shows the empty-history message when there are no set-runs yet", () => {
    renderWithIntl();
    expect(screen.getByText(/No set-runs yet/)).toBeInTheDocument();
  });
});
