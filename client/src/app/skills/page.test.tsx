import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/skills.json";

// AppShell pulls in repo-context/theme/pulls hooks unrelated to this page;
// stub it to a passthrough, same pattern as `SkillsListView.test.tsx` used
// to (this page replaces that grid — see `page.tsx`'s header comment).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const routerReplace = vi.fn();
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
}));

const useSkillsMock = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => useSkillsMock(),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import SkillsPage from "./page";

afterEach(() => {
  cleanup();
  routerReplace.mockClear();
  routerPush.mockClear();
  useSkillsMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillsPage (/skills)", () => {
  it("redirects to the first skill's editor once the list loads, instead of showing a grid", () => {
    useSkillsMock.mockReturnValue({
      data: [
        { id: "s1", name: "PR Quality Rubric", description: "d", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 },
        { id: "s2", name: "No Then Chains", description: "d2", type: "convention", source: "manual", body: "b2", enabled: true, version: 1 },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithIntl(<SkillsPage />);
    expect(routerReplace).toHaveBeenCalledWith("/skills/s1?tab=config");
  });

  it("shows a loading skeleton while the list is in flight, without redirecting", () => {
    useSkillsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderWithIntl(<SkillsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("shows the empty state (not a redirect) when there are zero skills, with a working Add flow", () => {
    useSkillsMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderWithIntl(<SkillsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Import from file"));
    // Import mode opens the drawer at its dropzone step (no name field yet
    // — that only appears after a file's been previewed, per
    // `SkillDrawer.tsx`'s `mode !== "import" || previewed` gate); the
    // drawer's own title is the reliable "it opened" signal here.
    expect(screen.getByText("Add a skill")).toBeInTheDocument();
  });

  it("shows ErrorState with retry on a load failure, without redirecting", () => {
    const refetch = vi.fn();
    useSkillsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderWithIntl(<SkillsPage />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
  });
});
