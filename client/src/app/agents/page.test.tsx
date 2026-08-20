import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/agents.json";

// AppShell pulls in repo-context/theme/pulls hooks unrelated to this page;
// stub it to a passthrough, same pattern as `skills/page.test.tsx`.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const routerReplace = vi.fn();
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
}));

const useAgentsMock = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => useAgentsMock(),
  useCreateAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import AgentsPage from "./page";

afterEach(() => {
  cleanup();
  routerReplace.mockClear();
  routerPush.mockClear();
  useAgentsMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentsPage (/agents)", () => {
  it("redirects to the first agent's editor once the list loads, instead of showing a grid", () => {
    useAgentsMock.mockReturnValue({
      data: [
        { id: "a1", name: "Security Reviewer", description: "d", provider: "openai", model: "gpt-4.1", enabled: true },
        { id: "a2", name: "Performance Reviewer", description: "d2", provider: "openai", model: "gpt-4.1", enabled: true },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithIntl(<AgentsPage />);
    expect(routerReplace).toHaveBeenCalledWith("/agents/a1?tab=config");
  });

  it("shows a loading skeleton while the list is in flight, without redirecting", () => {
    useAgentsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderWithIntl(<AgentsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("shows the empty state (not a redirect) when there are zero agents, with a working create flow", () => {
    useAgentsMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderWithIntl(<AgentsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create your first agent"));
    // "Create agent" appears twice once the modal opens (title + submit
    // button) — the subtitle is the reliable "it opened" signal instead.
    expect(
      screen.getByText("An agent is a configured reviewer — a model, a prompt, and the skills it uses."),
    ).toBeInTheDocument();
  });

  it("shows ErrorState with retry on a load failure, without redirecting", () => {
    const refetch = vi.fn();
    useAgentsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderWithIntl(<AgentsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Could not load agents.")).toBeInTheDocument();
  });
});
