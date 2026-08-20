import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import type { Skill } from "@devdigest/shared";

const updateMutate = vi.fn();
const useUpdateSkillMock = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => useUpdateSkillMock(),
}));

import { ConfigTab } from "./ConfigTab";

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "PR Quality Rubric",
    description: "Checks PR quality",
    type: "rubric",
    source: "manual",
    body: "# Rule",
    enabled: true,
    version: 3,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConfigTab", () => {
  it("renders the skill's name/description/type/body and version badge (AC-5)", () => {
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false });
    renderWithIntl(<ConfigTab skill={skill()} />);

    expect(screen.getByDisplayValue("PR Quality Rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Checks PR quality")).toBeInTheDocument();
    expect(screen.getByDisplayValue("# Rule")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("rubric");
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("shows a live token count next to the body editor that updates as the body changes (AC-5)", () => {
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false });
    renderWithIntl(<ConfigTab skill={skill({ body: "# Rule" })} />); // 6 chars -> ceil(6/4) = 2
    expect(screen.getByText("~2 tokens")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule\nSome more body text." } });
    // 26 chars -> ceil(26/4) = 7
    expect(screen.getByText("~7 tokens")).toBeInTheDocument();
  });

  it("does not show the untrusted-source notice for a manual, enabled skill", () => {
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false });
    renderWithIntl(<ConfigTab skill={skill({ source: "manual", enabled: true })} />);
    expect(
      screen.queryByText(/came from an untrusted source/),
    ).not.toBeInTheDocument();
  });

  it("shows the untrusted-source notice for an imported, still-disabled skill (AC-6)", () => {
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false });
    renderWithIntl(<ConfigTab skill={skill({ source: "imported_url", enabled: false })} />);
    expect(screen.getByText(/came from an untrusted source/)).toBeInTheDocument();
  });

  it("saving persists the edited fields through the existing useUpdateSkill (AC-7)", () => {
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false });
    renderWithIntl(<ConfigTab skill={skill()} />);

    fireEvent.change(screen.getByDisplayValue("PR Quality Rubric"), { target: { value: "Renamed Rubric" } });
    fireEvent.click(screen.getByText("Save"));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "s1",
      patch: {
        name: "Renamed Rubric",
        description: "Checks PR quality",
        type: "rubric",
        body: "# Rule",
        enabled: true,
      },
    });
  });
});
