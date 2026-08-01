import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import { SkillDrawer } from "./SkillDrawer";

const createMutate = vi.fn().mockResolvedValue({ id: "new" });
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkill: () => ({ data: undefined }),
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillDrawer", () => {
  it("create mode: Save is disabled until name + body are filled", () => {
    renderWithIntl(<SkillDrawer mode="create" onClose={vi.fn()} />);
    const save = screen.getByText("Save").closest("button")!;
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), {
      target: { value: "My Skill" },
    });
    expect(save).toBeDisabled(); // name alone is not enough — body is still empty
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[textareas.length - 1]!, { target: { value: "# My Skill\nBody." } });
    expect(save).not.toBeDisabled();
  });

  it("create mode: submitting calls useCreateSkill and closes", async () => {
    const onClose = vi.fn();
    renderWithIntl(<SkillDrawer mode="create" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), {
      target: { value: "My Skill" },
    });
    // Fill body via the mono textarea (only one Textarea in create mode besides description input).
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[textareas.length - 1]!, { target: { value: "# My Skill\nBody." } });
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    expect(createMutate).toHaveBeenCalled();
  });
});
