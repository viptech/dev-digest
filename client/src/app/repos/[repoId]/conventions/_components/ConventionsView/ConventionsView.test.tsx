import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/conventions.json";

// AppShell pulls in repo-context/theme/pulls hooks that are unrelated to
// this view; stub it to a passthrough so the test only exercises the view.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const extractMutate = vi.fn();
const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: [
      {
        id: "c1",
        rule: "Services take a Container.",
        category: "Structure",
        evidence_path: "src/service.ts",
        evidence_snippet: "ctor",
        evidence_line: 5,
        confidence: 0.9,
        accepted: false,
        status: "pending",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false, isError: false }),
  useUpdateConvention: () => ({ mutateAsync: updateMutateAsync, mutate: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));
let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/demo", default_branch: "main" } }),
  useRepoNotFound: () => repoNotFound,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo-not-found</div>,
}));

import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  repoNotFound = false;
  updateMutateAsync.mockClear();
  updateMutateAsync.mockResolvedValue(undefined);
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("renders the heading with the repo name and the candidate list", () => {
    renderWithIntl(<ConventionsView />);
    expect(screen.getByText(/acme\/demo/)).toBeInTheDocument();
    expect(screen.getByText("Services take a Container.")).toBeInTheDocument();
  });

  it("clicking the extract button triggers extraction", () => {
    renderWithIntl(<ConventionsView />);
    fireEvent.click(screen.getByText("Re-scan"));
    expect(extractMutate).toHaveBeenCalledWith("code");
  });

  it("selecting the LLM sampling mode and clicking extract calls mutate with 'llm'", () => {
    renderWithIntl(<ConventionsView />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "llm" } });
    fireEvent.click(screen.getByText("Re-scan"));
    expect(extractMutate).toHaveBeenCalledWith("llm");
  });

  it("shows RepoNotFound instead of the grid when the repo doesn't resolve", () => {
    repoNotFound = true;
    renderWithIntl(<ConventionsView />);
    expect(screen.getByText("repo-not-found")).toBeInTheDocument();
    expect(screen.queryByText("Services take a Container.")).not.toBeInTheDocument();
  });

  it("clears the Accepting state and surfaces an inline error when accept fails", async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderWithIntl(<ConventionsView />);
    fireEvent.click(screen.getByText("Accept as Skill"));
    expect(await screen.findByText("Couldn't accept — try again.")).toBeInTheDocument();
    expect(screen.getByText("Accept as Skill")).toBeInTheDocument();
    expect(screen.queryByText("Accepting…")).not.toBeInTheDocument();
  });
});
