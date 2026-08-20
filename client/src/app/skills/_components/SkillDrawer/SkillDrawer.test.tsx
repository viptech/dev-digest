import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import projectContextMessages from "../../../../../messages/en/projectContext.json";
import { SkillDrawer } from "./SkillDrawer";

const createMutate = vi.fn().mockResolvedValue({ id: "new" });
const importSaveMutate = vi.fn().mockResolvedValue({ id: "new-imported" });
const importPreviewMutate = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
  useImportPreview: () => ({ mutateAsync: importPreviewMutate, isPending: false }),
  useImportSkill: () => ({ mutateAsync: importSaveMutate, isPending: false }),
}));

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  importSaveMutate.mockClear();
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

  it("create mode: submitting calls useCreateSkill and navigates to the new skill's editor route instead of just closing (AC-4)", async () => {
    const onClose = vi.fn();
    renderWithIntl(<SkillDrawer mode="create" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), {
      target: { value: "My Skill" },
    });
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[textareas.length - 1]!, { target: { value: "# My Skill\nBody." } });
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();
    expect(createMutate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/skills/new?tab=config");
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

  it("import mode: submitting a previewed import calls useImportSkill and navigates to the new skill's editor route", async () => {
    importPreviewMutate.mockResolvedValueOnce({ name: "Imported Skill", description: "d", body: "b" });
    const onClose = vi.fn();
    renderWithIntl(<SkillDrawer mode="import" onClose={onClose} />);
    const file = new File(["# Imported\nBody."], "imported.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByDisplayValue("Imported Skill")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();
    expect(importSaveMutate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/skills/new-imported?tab=config");
  });
});
