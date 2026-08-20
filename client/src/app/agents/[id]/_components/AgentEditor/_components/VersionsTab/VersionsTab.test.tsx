import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/agents.json";
import type { AgentVersion } from "@devdigest/shared";

// Deliberately distinct field values across the two fixture versions (client
// INSIGHTS.md duplicate-`getByText` gotcha class) so no assertion below can
// accidentally match more than one element.
const V1: AgentVersion = {
  agent_id: "a1",
  version: 1,
  config: {
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "keep this\nremove this",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: ["sk1"],
  },
  created_at: "2026-08-01T00:00:00.000Z",
};
const V2: AgentVersion = {
  agent_id: "a1",
  version: 2,
  config: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    system_prompt: "keep this\nadd this",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: ["sk1"],
  },
  created_at: "2026-08-10T00:00:00.000Z",
};
// Newest first, the same order `GET /agents/:id/versions` returns.
const VERSIONS: AgentVersion[] = [V2, V1];

const useAgentVersionsMock = vi.fn();
const updateMutate = vi.fn();
const useUpdateAgentMock = vi.fn();
const setSkillsMutate = vi.fn();
const useSetAgentSkillsMock = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentVersions: () => useAgentVersionsMock(),
  useUpdateAgent: () => useUpdateAgentMock(),
  useSetAgentSkills: () => useSetAgentSkillsMock(),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  useAgentVersionsMock.mockReset();
  updateMutate.mockClear();
  setSkillsMutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab (agent)", () => {
  it("shows a loading state while versions are pending", () => {
    useAgentVersionsMock.mockReturnValue({ data: undefined, isLoading: true });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);
    expect(screen.getByText("Loading versions…")).toBeInTheDocument();
  });

  it("renders the version list newest first", () => {
    useAgentVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);

    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("renders a system-prompt diff plus the non-prompt field changes once exactly two versions are selected", () => {
    useAgentVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);

    expect(screen.queryByText(/remove this/)).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    expect(screen.getByText(/remove this/)).toBeInTheDocument();
    expect(screen.getByText(/add this/)).toBeInTheDocument();
    expect(screen.getByText(/keep this/)).toBeInTheDocument();
    expect(screen.getByText("System prompt diff: v1 → v2")).toBeInTheDocument();

    // Provider + model differ between V1/V2 — both should surface in "Also changed".
    expect(screen.getByText("Provider: openai → anthropic")).toBeInTheDocument();
    expect(screen.getByText("Model: gpt-4.1 → claude-sonnet-5")).toBeInTheDocument();
  });

  it("Restore reapplies the selected version's full config AND its linked skills, not just the prompt", () => {
    useAgentVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);

    const restoreButtons = screen.getAllByText("Restore");
    // VERSIONS[1] is v1 (older) — restoring it must send v1's own config, not v2's.
    fireEvent.click(restoreButtons[1]!);

    expect(updateMutate).toHaveBeenCalledWith({
      id: "a1",
      patch: {
        provider: "openai",
        model: "gpt-4.1",
        system_prompt: "keep this\nremove this",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
      },
    });
    expect(setSkillsMutate).toHaveBeenCalledWith(["sk1"]);
  });

  it("View opens a modal with that version's full system prompt and config", () => {
    useAgentVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);

    expect(screen.queryByText(/add this/)).not.toBeInTheDocument();

    // VERSIONS[0] is v2 (newest first) — its "View" button is the first one.
    const viewButtons = screen.getAllByText("View");
    fireEvent.click(viewButtons[0]!);

    expect(screen.getByText(/add this/)).toBeInTheDocument();
    // v2's own model/provider — unique to the modal in this render (no diff selected).
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("Restore from inside the modal reapplies that version's full config and closes the modal", () => {
    useAgentVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    useSetAgentSkillsMock.mockReturnValue({ mutate: setSkillsMutate, isPending: false });
    renderWithIntl(<VersionsTab agentId="a1" />);

    fireEvent.click(screen.getAllByText("View")[1]!); // v1 (older)
    expect(screen.getByText(/remove this/)).toBeInTheDocument();

    // Two "Restore" buttons now exist (the row's + the modal's) — the modal's is the last.
    const restoreButtons = screen.getAllByText("Restore");
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!);

    expect(updateMutate).toHaveBeenCalledWith({
      id: "a1",
      patch: {
        provider: "openai",
        model: "gpt-4.1",
        system_prompt: "keep this\nremove this",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
      },
    });
    expect(setSkillsMutate).toHaveBeenCalledWith(["sk1"]);
    expect(screen.queryByText("System prompt")).not.toBeInTheDocument();
  });
});
