import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import type { SkillVersion } from "@devdigest/shared";

// Deliberately distinct `created_at`/`body` values across the two fixture
// versions (client INSIGHTS.md duplicate-`getByText` gotcha class) so no
// assertion below can accidentally match more than one element.
const V1: SkillVersion = {
  skill_id: "sk1",
  version: 1,
  body: "keep this\nremove this",
  created_at: "2026-08-01T00:00:00.000Z",
};
const V2: SkillVersion = {
  skill_id: "sk1",
  version: 2,
  body: "keep this\nadd this",
  created_at: "2026-08-10T00:00:00.000Z",
};
// Newest first (AC-28), the same order `GET /skills/:id/versions` returns.
const VERSIONS: SkillVersion[] = [V2, V1];

const useSkillVersionsMock = vi.fn();
const updateMutate = vi.fn();
const useUpdateSkillMock = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => useSkillVersionsMock(),
  useUpdateSkill: () => useUpdateSkillMock(),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  useSkillVersionsMock.mockReset();
  updateMutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab", () => {
  it("shows a loading state while versions are pending", () => {
    useSkillVersionsMock.mockReturnValue({ data: undefined, isLoading: true });
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    renderWithIntl(<VersionsTab skillId="sk1" />);
    expect(screen.getByText("Loading versions…")).toBeInTheDocument();
  });

  it("renders the version list newest first (AC-28)", () => {
    useSkillVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    renderWithIntl(<VersionsTab skillId="sk1" />);

    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("renders a line-level diff once exactly two versions are selected (AC-29)", () => {
    useSkillVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    renderWithIntl(<VersionsTab skillId="sk1" />);

    expect(screen.queryByText(/remove this/)).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    expect(screen.getByText(/remove this/)).toBeInTheDocument();
    expect(screen.getByText(/add this/)).toBeInTheDocument();
    expect(screen.getByText(/keep this/)).toBeInTheDocument();
    expect(screen.getByText("Diff: v1 → v2")).toBeInTheDocument();
  });

  it("Restore calls the existing useUpdateSkill with the selected version's body, no new mutation (AC-30)", () => {
    useSkillVersionsMock.mockReturnValue({ data: VERSIONS, isLoading: false });
    useUpdateSkillMock.mockReturnValue({ mutate: updateMutate, isPending: false });
    renderWithIntl(<VersionsTab skillId="sk1" />);

    const restoreButtons = screen.getAllByText("Restore");
    // VERSIONS[1] is v1 (older) — restoring it must send v1's own body, not v2's.
    fireEvent.click(restoreButtons[1]!);

    expect(updateMutate).toHaveBeenCalledWith({ id: "sk1", patch: { body: V1.body } });
  });
});
