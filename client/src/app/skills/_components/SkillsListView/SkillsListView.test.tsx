import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import projectContextMessages from "../../../../../messages/en/projectContext.json";

// AppShell pulls in repo-context/theme/pulls hooks that are unrelated to
// this view; stub it to a passthrough so the test only exercises the list.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      {
        id: "s1",
        name: "PR Quality Rubric",
        description: "d",
        type: "rubric",
        source: "manual",
        body: "b",
        enabled: true,
        version: 1,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateSkill: () => ({ mutate: vi.fn() }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  routerPush.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ skills: messages, projectContext: projectContextMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillsListView", () => {
  it("renders the skill list", () => {
    renderWithIntl(<SkillsListView />);
    expect(screen.getByText("PR Quality Rubric")).toBeInTheDocument();
  });

  it("filters by search text", () => {
    renderWithIntl(<SkillsListView />);
    const input = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(input, { target: { value: "nonexistent" } });
    expect(screen.queryByText("PR Quality Rubric")).not.toBeInTheDocument();
  });

  it("the Add Skill menu offers a 'Create from scratch' entry that opens the drawer in create mode", () => {
    renderWithIntl(<SkillsListView />);
    fireEvent.click(screen.getByText("Add Skill"));
    fireEvent.click(screen.getByText("Create from scratch"));
    // Create mode renders the empty-name placeholder from the drawer's name field.
    expect(screen.getByPlaceholderText("pr-quality-rubric")).toBeInTheDocument();
  });

  it("clicking a skill card navigates to /skills/:id instead of opening a drawer (AC-2)", () => {
    renderWithIntl(<SkillsListView />);
    fireEvent.click(screen.getByText("PR Quality Rubric"));
    expect(routerPush).toHaveBeenCalledWith("/skills/s1");
    // No drawer field (e.g. the name text input) appears — only the card grid.
    expect(screen.queryByPlaceholderText("pr-quality-rubric")).not.toBeInTheDocument();
  });
});
