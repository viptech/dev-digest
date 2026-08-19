import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboardAgentSummary } from "@/lib/hooks/evals";
import messages from "../../../../../messages/en/eval.json";

// AppShell pulls in repo-context/theme/shell hooks unrelated to this view.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// A card click navigates to that agent's Evals tab.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

let dashboard: unknown = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
const runAllMutateAsync = vi.fn().mockResolvedValue({ total: 0, failed: 0 });
vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => dashboard,
  useRunAllAgentEvalSets: () => ({ mutateAsync: runAllMutateAsync, isPending: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  runAllMutateAsync.mockClear();
  routerPush.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

// One agent, two historical set-runs (SPEC-05 T14 shape — `recent_runs`,
// newest-first, `version` ascending from the agent's oldest run).
const SECURITY_REVIEWER: EvalDashboardAgentSummary = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_model: "gpt-4.1",
  cases_total: 8,
  recent_runs: [
    {
      run_group_id: "g2",
      version: 2,
      ran_at: "2026-08-19T00:00:00.000Z",
      cases_total: 8,
      cases_passed: 7,
      recall: 0.9,
      precision: 0.75,
      citation_accuracy: 1,
    },
    {
      run_group_id: "g1",
      version: 1,
      ran_at: "2026-08-10T00:00:00.000Z",
      cases_total: 8,
      cases_passed: 6,
      recall: 0.8,
      precision: 0.7,
      citation_accuracy: 0.9,
    },
  ],
  last_run: {
    run_group_id: "g2",
    version: 2,
    ran_at: "2026-08-19T00:00:00.000Z",
    cases_total: 8,
    cases_passed: 7,
    recall: 0.9,
    precision: 0.75,
    citation_accuracy: 1,
  },
};

describe("EvalDashboardView", () => {
  it("renders the per-agent card with its latest run's metrics, model badge, and version", () => {
    dashboard = { data: [SECURITY_REVIEWER], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    // "Security Reviewer" also appears in the 2-row "Recent eval runs" table
    // below (its own recent_runs), so this is 1 card + 2 history rows.
    expect(screen.getAllByText("Security Reviewer")).toHaveLength(3);
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText(/8 cases/)).toBeInTheDocument();
    expect(screen.getByText(/Last run v2/)).toBeInTheDocument();
    // "90%" appears 3 times: the card's RECALL (last_run.recall=0.9), the
    // newest history row's recall bar (mirrors last_run), and the older
    // history row's citation_accuracy bar (0.9, an unrelated coincidence in
    // this fixture). "75%" appears twice: card PREC + newest history row.
    expect(screen.getAllByText("90%")).toHaveLength(3);
    expect(screen.getAllByText("75%")).toHaveLength(2);
  });

  it("clicking a card navigates to that agent's per-agent Eval Dashboard drill-down (T15)", () => {
    dashboard = { data: [SECURITY_REVIEWER], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    // "Security Reviewer" also labels the two history rows below the card —
    // the card itself (with its model badge) is the first occurrence.
    fireEvent.click(screen.getAllByText("Security Reviewer")[0]!);
    expect(routerPush).toHaveBeenCalledWith("/eval-dashboard/ag1");
  });

  it("shows a percentage next to each metric bar in the history table", () => {
    dashboard = { data: [SECURITY_REVIEWER], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    // The older history row (version 1: recall 0.8, precision 0.7, citation
    // 0.9) has values that don't collide with the card's last_run — a clean
    // way to confirm the bars actually render their own percentages, not
    // just reuse the card's numbers.
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("renders a recall sparkline for an agent with run history", () => {
    dashboard = { data: [SECURITY_REVIEWER], isLoading: false, isError: false, refetch: vi.fn() };
    const { container } = renderWithIntl();
    expect(container.querySelector("svg path")).toBeInTheDocument();
  });

  it('shows a "Never run" empty state for an agent with zero set-runs, without erroring the page (AC-21)', () => {
    dashboard = {
      data: [{ agent_id: "ag2", agent_name: "Fresh Agent", agent_model: "gpt-4o", cases_total: 3, recent_runs: [], last_run: null }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWithIntl();
    expect(screen.getByText("Fresh Agent")).toBeInTheDocument();
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });

  it("renders the empty state when the workspace has no agents at all", () => {
    dashboard = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it('"Recent eval runs" flattens every agent\'s history, newest first across agents', () => {
    const olderAgent: EvalDashboardAgentSummary = {
      agent_id: "ag3",
      agent_name: "Performance Reviewer",
      agent_model: "gpt-4o",
      cases_total: 5,
      recent_runs: [
        {
          run_group_id: "g3",
          version: 1,
          ran_at: "2026-08-15T00:00:00.000Z",
          cases_total: 5,
          cases_passed: 4,
          recall: 0.74,
          precision: 0.88,
          citation_accuracy: 0.9,
        },
      ],
      last_run: null as unknown as EvalDashboardAgentSummary["last_run"],
    };
    olderAgent.last_run = olderAgent.recent_runs[0]!;

    dashboard = { data: [SECURITY_REVIEWER, olderAgent], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();

    expect(screen.getByText("Recent eval runs · all agents")).toBeInTheDocument();
    // 3 rows total across both agents (2 from Security Reviewer + 1 from
    // Performance Reviewer) — spot-check the agent names appear as row labels.
    expect(screen.getAllByText("Security Reviewer")).toHaveLength(3); // 1 card + 2 history rows
    expect(screen.getAllByText("Performance Reviewer")).toHaveLength(2); // 1 card + 1 history row
    // "v1" appears twice: Security Reviewer's older history run AND
    // Performance Reviewer's only run — "v2" is unique to Security Reviewer.
    expect(screen.getAllByText("v1")).toHaveLength(2);
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  it("shows the empty-history message when agents exist but have never run", () => {
    dashboard = {
      data: [{ agent_id: "ag2", agent_name: "Fresh Agent", agent_model: "gpt-4o", cases_total: 3, recent_runs: [], last_run: null }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWithIntl();
    expect(screen.getByText("No eval runs yet — run an agent's eval set to see history here.")).toBeInTheDocument();
  });

  it('"Run all agents" calls the run-all mutation with every agent id', async () => {
    dashboard = { data: [SECURITY_REVIEWER], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    fireEvent.click(screen.getByText("Run all agents"));
    await waitFor(() => expect(runAllMutateAsync).toHaveBeenCalledWith(["ag1"]));
  });

  it('"Run all agents" is disabled when there are no agents', () => {
    dashboard = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderWithIntl();
    expect(screen.getByText("Run all agents").closest("button")).toBeDisabled();
  });
});
