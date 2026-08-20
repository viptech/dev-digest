import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import type { SkillStats } from "@devdigest/shared";

// Deliberately distinct numeric fixtures across every stat/agent/category
// (client INSIGHTS.md 2026-08-02/2026-08-19 duplicate-`getByText` gotcha) —
// used_by_agents/pull_rate/accept_rate/agent pull rates/category costs all
// differ from each other and from the spec's own mockup copy ("74% accept"),
// so no assertion below can accidentally match more than one element.
const STATS: SkillStats = {
  skill_id: "sk1",
  skill_name: "PR Quality Rubric",
  used_by_agents: 3,
  pull_rate: 0.62,
  accept_rate: 0.81,
  agents: [
    { agent_id: "a1", agent_name: "Security Reviewer", pull_rate: 0.9 },
    { agent_id: "a2", agent_name: "Style Bot", pull_rate: null },
  ],
  cost_by_category: [
    { category: "security", cost_usd: 12.5 },
    { category: "style", cost_usd: 4.25 },
  ],
};

const useSkillStatsMock = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => useSkillStatsMock(),
}));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  useSkillStatsMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("StatsTab (skill)", () => {
  it("shows a loading state while stats are pending", () => {
    useSkillStatsMock.mockReturnValue({ data: undefined, isLoading: true });
    renderWithIntl(<StatsTab skillId="sk1" />);
    expect(screen.getByText("Loading stats…")).toBeInTheDocument();
  });

  it("renders used_by/pull_rate/accept_rate tiles (AC-22, AC-23)", () => {
    useSkillStatsMock.mockReturnValue({ data: STATS, isLoading: false });
    renderWithIntl(<StatsTab skillId="sk1" />);

    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("81%")).toBeInTheDocument();
  });

  it("renders the 'Agents using this skill' list from stats.agents (AC-22)", () => {
    useSkillStatsMock.mockReturnValue({ data: STATS, isLoading: false });
    renderWithIntl(<StatsTab skillId="sk1" />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Style Bot")).toBeInTheDocument();
  });

  it("shows '—' for a null pull_rate/accept_rate, never '0%' (AC-24, AC-25)", () => {
    useSkillStatsMock.mockReturnValue({
      data: { ...STATS, pull_rate: null, accept_rate: null, agents: [STATS.agents[1]!] },
      isLoading: false,
    });
    renderWithIntl(<StatsTab skillId="sk1" />);

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    // One per MetricCard (pull_rate, accept_rate) + one for the agent row's
    // own null pull_rate.
    expect(dashes.length).toBe(3);
  });

  it("renders the 'Findings by category' donut in dollars, not raw counts (AC-26)", () => {
    useSkillStatsMock.mockReturnValue({ data: STATS, isLoading: false });
    renderWithIntl(<StatsTab skillId="sk1" />);

    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("style")).toBeInTheDocument();
    expect(screen.getByText("$4.25")).toBeInTheDocument();
  });

  it("shows the empty/never-linked state without a failing query (AC-27)", () => {
    useSkillStatsMock.mockReturnValue({
      data: {
        skill_id: "sk1",
        skill_name: "PR Quality Rubric",
        used_by_agents: 0,
        pull_rate: null,
        accept_rate: null,
        agents: [],
        cost_by_category: [],
      },
      isLoading: false,
    });
    renderWithIntl(<StatsTab skillId="sk1" />);

    expect(screen.getByText("0 agents")).toBeInTheDocument();
    expect(screen.getByText("Not linked to any agent yet.")).toBeInTheDocument();
    expect(screen.getByText("No cost data in this window.")).toBeInTheDocument();
  });
});
