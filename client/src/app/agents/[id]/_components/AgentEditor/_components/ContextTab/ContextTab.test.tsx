import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/projectContext.json";

const setMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentContextDocs: () => ({
    data: [{ agent_id: "ag1", repo_id: "repo1", path: "specs/a.md", order: 0, owner: "acme", name: "api" }],
  }),
  useSetAgentContextDocs: () => ({ mutate: setMutate, isPending: false }),
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

afterEach(cleanup);

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
    expect(screen.getByText("1 attached")).toBeInTheDocument();
  });

  it("detaching the only attached doc calls setAgentContextDocs with []", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);
    fireEvent.click(screen.getByLabelText("Detach"));
    expect(setMutate).toHaveBeenCalledWith([]);
  });
});
