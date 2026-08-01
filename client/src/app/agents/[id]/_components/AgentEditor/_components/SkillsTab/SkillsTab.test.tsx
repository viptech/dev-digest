import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/agents.json";

const setMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      { id: "a", name: "Skill A", description: "d", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 },
      { id: "b", name: "Skill B", description: "d", type: "security", source: "manual", body: "b", enabled: true, version: 1 },
    ],
  }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: () => ({ data: [{ agent_id: "ag1", skill_id: "a", order: 0 }] }),
  useSetAgentSkills: () => ({ mutate: setMutate }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("shows linked count and both skills, linked skill checked", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    expect(screen.getByText("Skill A")).toBeInTheDocument();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 enabled")).toBeInTheDocument();
  });

  it("checking an unlinked skill calls setSkills with it appended", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!); // Skill B's checkbox
    expect(setMutate).toHaveBeenCalledWith(["a", "b"]);
  });

  it("unchecking the only linked skill calls setSkills with an empty array", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!); // Skill A's checkbox (currently linked)
    expect(setMutate).toHaveBeenCalledWith([]);
  });
});
