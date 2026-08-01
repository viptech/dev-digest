import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import { SkillDrawer } from "./SkillDrawer";

const createMutate = vi.fn().mockResolvedValue({ id: "new" });
const deleteMutate = vi.fn();
const importPreviewMutate = vi.fn();
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkill: () => ({
    data: {
      id: "s1",
      name: "Existing",
      description: "d",
      type: "custom",
      body: "b",
      source: "manual",
      enabled: true,
      version: 1,
    },
  }),
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useImportPreview: () => ({ mutateAsync: importPreviewMutate, isPending: false }),
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

  it("import mode: a failed preview shows an error instead of hanging silently", async () => {
    importPreviewMutate.mockRejectedValueOnce(new Error("network error"));
    renderWithIntl(<SkillDrawer mode="import" onClose={vi.fn()} />);
    const file = new File(["# Hello\nBody."], "hello.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("Import failed")).toBeInTheDocument();
    // The dropzone stays put so the user can pick a different file.
    expect(input).toBeInTheDocument();
  });

  it("create mode: a failed save shows an error instead of failing silently", async () => {
    createMutate.mockRejectedValueOnce(new Error("server error"));
    const onClose = vi.fn();
    renderWithIntl(<SkillDrawer mode="create" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), {
      target: { value: "My Skill" },
    });
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[textareas.length - 1]!, { target: { value: "# My Skill\nBody." } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Could not save this skill. Please try again.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("edit mode: a failed delete shows an error instead of failing silently", async () => {
    deleteMutate.mockRejectedValueOnce(new Error("server error"));
    const onClose = vi.fn();
    renderWithIntl(<SkillDrawer mode="edit" skillId="s1" onClose={onClose} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByText("Could not delete this skill. Please try again.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
