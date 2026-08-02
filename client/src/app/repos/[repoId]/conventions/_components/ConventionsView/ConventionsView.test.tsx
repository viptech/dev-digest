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
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: [
      {
        id: "c1",
        rule: "Services take a Container.",
        evidence_path: "src/service.ts",
        evidence_snippet: "ctor",
        confidence: 0.9,
        accepted: false,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false, isError: false }),
  useUpdateConvention: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { full_name: "acme/demo" } }) }));

import { ConventionsView } from "./ConventionsView";

afterEach(cleanup);

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
    expect(extractMutate).toHaveBeenCalled();
  });
});
