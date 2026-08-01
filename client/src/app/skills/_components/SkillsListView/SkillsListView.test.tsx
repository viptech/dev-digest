import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";

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
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SkillsListView } from "./SkillsListView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
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
});
