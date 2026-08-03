import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/conventions.json";
import type { ConventionCandidate } from "@devdigest/shared";
import { buildSkillBody } from "./helpers";

const createMutateAsync = vi.fn().mockResolvedValue({ id: "new-skill-id" });
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

const useAgentsMock = vi.fn(() => ({
  data: [
    { id: "a1", name: "Agent One" },
    { id: "a2", name: "Agent Two" },
  ],
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => useAgentsMock(),
}));

const apiPost = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/api", () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

import { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";

const accepted: ConventionCandidate[] = [
  {
    id: "c1",
    rule: "Services take a Container.",
    category: "Structure",
    evidence_path: "src/service.ts",
    evidence_snippet: "ctor",
    evidence_line: 5,
    confidence: 0.9,
    accepted: true,
    status: "accepted",
  },
  {
    id: "c2",
    rule: "Wire contracts are snake_case.",
    category: "Contracts",
    evidence_path: null,
    evidence_snippet: null,
    evidence_line: null,
    confidence: 0.7,
    accepted: true,
    status: "accepted",
  },
];

afterEach(() => {
  cleanup();
  createMutateAsync.mockClear();
  apiPost.mockClear();
  useAgentsMock.mockClear();
  useAgentsMock.mockReturnValue({
    data: [
      { id: "a1", name: "Agent One" },
      { id: "a2", name: "Agent Two" },
    ],
  });
});

function renderWithIntl(ui: React.ReactElement, qc: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("buildSkillBody", () => {
  it("includes every accepted candidate's rule and evidence reference", () => {
    const body = buildSkillBody(accepted);
    expect(body).toContain("Services take a Container. (src/service.ts:5)");
    expect(body).toContain("Wire contracts are snake_case.");
    expect(body).not.toContain("Wire contracts are snake_case. (");
  });
});

describe("CreateSkillFromConventionsModal", () => {
  it("Save is disabled without a name", () => {
    renderWithIntl(<CreateSkillFromConventionsModal accepted={accepted} onClose={vi.fn()} />);
    const save = screen.getByText("Create skill").closest("button")!;
    const nameInput = screen.getByDisplayValue("repo-conventions");
    fireEvent.change(nameInput, { target: { value: "" } });
    expect(save).toBeDisabled();
  });

  it("Save is disabled without a description", () => {
    renderWithIntl(<CreateSkillFromConventionsModal accepted={accepted} onClose={vi.fn()} />);
    const save = screen.getByText("Create skill").closest("button")!;
    const descriptionInput = screen.getByDisplayValue("House conventions extracted from this repo.");
    fireEvent.change(descriptionInput, { target: { value: "  " } });
    expect(save).toBeDisabled();
  });

  it("Save is disabled without a selected agent", () => {
    useAgentsMock.mockReturnValue({ data: [] });
    renderWithIntl(<CreateSkillFromConventionsModal accepted={accepted} onClose={vi.fn()} />);
    const save = screen.getByText("Create skill").closest("button")!;
    expect(save).toBeDisabled();
  });

  it("submitting calls useCreateSkill then api.post with the returned skill id, and invalidates the agent-skills cache", async () => {
    const onClose = vi.fn();
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithIntl(<CreateSkillFromConventionsModal accepted={accepted} onClose={onClose} />, qc);
    await act(async () => {
      fireEvent.click(screen.getByText("Create skill"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createMutateAsync).toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledWith("/agents/a1/skills", { skill_id: "new-skill-id" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-skills", "a1"] });
    expect(onClose).toHaveBeenCalled();
  });

  it("a failure in either call surfaces an error and keeps the modal open", async () => {
    createMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onClose = vi.fn();
    renderWithIntl(<CreateSkillFromConventionsModal accepted={accepted} onClose={onClose} />);
    fireEvent.click(screen.getByText("Create skill"));
    expect(await screen.findByText("Couldn't create the skill. Please try again.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
