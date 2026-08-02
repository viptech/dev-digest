import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentStats, RunTrace } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import runsMessages from "../../../../../../../../messages/en/runs.json";

const STATS: AgentStats = {
  agent_id: "a1",
  agent_name: "Agent",
  runs: 5,
  findings_total: 3,
  accepted: 2,
  dismissed: 1,
  pending: 0,
  accept_rate: 0.667,
  dismiss_rate: 0.333,
  avg_findings_per_run: 0.6,
  total_cost_usd: 0.2,
  avg_cost_usd: 0.04,
  avg_latency_ms: 6200,
  findings_by_severity: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
  trend: [],
  most_used_skills: [{ skill_id: "s1", name: "Corner Cases", pct: 0.8 }],
  findings_by_category: [{ category: "security", count: 1 }, { category: "bug", count: 2 }],
  run_history: [
    // cost_usd deliberately != avg_cost_usd (0.04) so it doesn't collide as
    // duplicate "$0.04" text with the AVG COST / RUN tile under getByText.
    { run_id: "r1", ran_at: "2026-07-01T00:00:00Z", pr_number: 482, tokens_in: 1000, tokens_out: 200, cost_usd: 0.05, findings_count: 3, source: "local" },
  ],
};

const TRACE: RunTrace = {
  config: { agent: "Agent", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 6200, tokens_in: 1000, tokens_out: 200, cost_usd: 0.05, findings: 3, grounding: "1/1 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentStats: () => ({ data: STATS, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: TRACE, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import { StatsTab } from "./StatsTab";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, runs: runsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("StatsTab", () => {
  it("renders the 4 headline tiles", () => {
    renderWithIntl(<StatsTab agentId="a1" />);
    expect(screen.getByText("5")).toBeInTheDocument(); // total runs
    expect(screen.getByText("$0.04")).toBeInTheDocument();
    expect(screen.getByText("6.2s")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("renders most-used skills and run history", () => {
    renderWithIntl(<StatsTab agentId="a1" />);
    expect(screen.getByText("Corner Cases")).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
  });

  it("opens the run trace drawer for a row when 'View trace' is clicked", () => {
    renderWithIntl(<StatsTab agentId="a1" />);
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("View trace"));
    expect(screen.getByText("Configuration")).toBeInTheDocument(); // RunTraceDrawer's trace tab
  });
});
