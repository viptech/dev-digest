import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/projectContext.json";

const setMutate = vi.fn();

const mockUseAgentContextDocs = vi.fn();
const mockUseAgentSkills = vi.fn();
const mockUseSkills = vi.fn();
const mockUseSkillsContextDocs = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentContextDocs: (...args: unknown[]) => mockUseAgentContextDocs(...args),
  useSetAgentContextDocs: () => ({ mutate: setMutate, isPending: false }),
  useAgentSkills: (...args: unknown[]) => mockUseAgentSkills(...args),
}));
vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: (...args: unknown[]) => mockUseSkills(...args),
  useSkillsContextDocs: (...args: unknown[]) => mockUseSkillsContextDocs(...args),
}));
vi.mock("../../../../../../../lib/hooks/core", () => ({
  useRepos: () => ({ data: [{ id: "repo1", owner: "acme", name: "api" }] }),
}));
vi.mock("../../../../../../../lib/hooks/project-context", () => ({
  useRepoContextDocs: () => ({
    data: [{ path: "specs/a.md", category: "specs", chars: 10, used_by_agents: 1 }],
  }),
  useContextDocContent: () => ({ data: undefined, isLoading: false }),
  useContextDocsCharsMap: () => new Map<string, number>(),
  approxTokens: (chars: number) => Math.ceil(chars / 4),
  CLIENT_CONTEXT_BUDGET_CHARS_WARNING: 24000,
}));

import { ContextTab } from "./ContextTab";

const ownDoc = { agent_id: "ag1", repo_id: "repo1", path: "specs/a.md", order: 0, owner: "acme", name: "api" };

function skill(id: string, enabled: boolean) {
  return {
    id,
    name: id,
    description: "",
    type: "custom" as const,
    source: "manual" as const,
    body: "",
    enabled,
    version: 1,
  };
}

beforeEach(() => {
  // Default: one own doc, no linked skills at all.
  mockUseAgentContextDocs.mockReturnValue({ data: [ownDoc] });
  mockUseAgentSkills.mockReturnValue({ data: [] });
  mockUseSkills.mockReturnValue({ data: [] });
  mockUseSkillsContextDocs.mockReturnValue(new Map());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("renders the agent's attached document", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);
    // Two badges read "1 attached" here (the aggregate badge and
    // ContextDocPicker's own-only badge) — they coincide whenever
    // fromSkills === 0, since total === own in that case.
    expect(screen.getAllByText("1 attached")).toHaveLength(2);
  });

  it("detaching the only attached doc calls setAgentContextDocs with []", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);
    fireEvent.click(screen.getByLabelText("Detach"));
    expect(setMutate).toHaveBeenCalledWith([]);
  });

  it("shows the combined agent+skills count and breakdown for an enabled linked skill", () => {
    mockUseAgentSkills.mockReturnValue({ data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }] });
    mockUseSkills.mockReturnValue({ data: [skill("sk1", true)] });
    mockUseSkillsContextDocs.mockReturnValue(
      new Map([
        [
          "sk1",
          [
            { skill_id: "sk1", repo_id: "repo1", path: "docs/b.md", order: 0, owner: "acme", name: "api" },
            { skill_id: "sk1", repo_id: "repo1", path: "docs/c.md", order: 1, owner: "acme", name: "api" },
          ],
        ],
      ]),
    );

    renderWithIntl(<ContextTab agentId="ag1" />);

    expect(screen.getByText("3 attached")).toBeInTheDocument();
    expect(screen.getByText("1 from this agent + 2 from linked skills")).toBeInTheDocument();
  });

  it("dedupes a doc attached both on the agent and via a linked skill (AC-26)", () => {
    mockUseAgentSkills.mockReturnValue({ data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }] });
    mockUseSkills.mockReturnValue({ data: [skill("sk1", true)] });
    mockUseSkillsContextDocs.mockReturnValue(
      new Map([
        [
          "sk1",
          [
            // Same (repo_id, path) as ownDoc — must count once, not twice.
            { skill_id: "sk1", repo_id: "repo1", path: "specs/a.md", order: 0, owner: "acme", name: "api" },
            { skill_id: "sk1", repo_id: "repo1", path: "docs/b.md", order: 1, owner: "acme", name: "api" },
          ],
        ],
      ]),
    );

    renderWithIntl(<ContextTab agentId="ag1" />);

    expect(screen.getByText("2 attached")).toBeInTheDocument();
    expect(screen.getByText("1 from this agent + 1 from linked skills")).toBeInTheDocument();
  });

  it("excludes a disabled linked skill's docs entirely from the count", () => {
    mockUseAgentSkills.mockReturnValue({ data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }] });
    mockUseSkills.mockReturnValue({ data: [skill("sk1", false)] });
    // Mock ignores the (empty, post-filter) args it's actually called with —
    // returning sk1's docs here regardless proves the exclusion happens via
    // the enabled-filter upstream, not because the hook itself was never
    // asked for sk1's docs.
    mockUseSkillsContextDocs.mockReturnValue(
      new Map([
        ["sk1", [{ skill_id: "sk1", repo_id: "repo1", path: "docs/b.md", order: 0, owner: "acme", name: "api" }]],
      ]),
    );

    renderWithIntl(<ContextTab agentId="ag1" />);

    expect(screen.getAllByText("1 attached")).toHaveLength(2);
    expect(screen.queryByText(/from this agent/)).not.toBeInTheDocument();
  });

  it("renders no breakdown line when there are no linked skills", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);
    expect(screen.getAllByText("1 attached")).toHaveLength(2);
    expect(screen.queryByText(/from this agent/)).not.toBeInTheDocument();
  });
});
