import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsTab } from "./StatsTab";
import type { AgentStats } from "@devdigest/shared";

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

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentStats: () => ({ data: STATS, isLoading: false }),
}));

describe("StatsTab", () => {
  it("renders the 4 headline tiles", () => {
    render(<StatsTab agentId="a1" />);
    expect(screen.getByText("5")).toBeInTheDocument(); // total runs
    expect(screen.getByText("$0.04")).toBeInTheDocument();
    expect(screen.getByText("6.2s")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("renders most-used skills and run history", () => {
    render(<StatsTab agentId="a1" />);
    expect(screen.getByText("Corner Cases")).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
  });
});
