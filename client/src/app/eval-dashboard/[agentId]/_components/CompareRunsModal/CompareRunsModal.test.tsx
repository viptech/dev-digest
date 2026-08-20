import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { VersionedRunGroup } from "@/lib/eval-runs";
import messages from "../../../../../../messages/en/eval.json";

const updateMutateAsync = vi.fn().mockResolvedValue({ id: "ag1" });
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  updateMutateAsync.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function group(over: Partial<VersionedRunGroup> = {}): VersionedRunGroup {
  return {
    run_group_id: "g",
    ran_at: "2026-08-01T00:00:00.000Z",
    version: 1,
    cases: [],
    aggregate: { recall: 1, precision: 1, citation_accuracy: 1 },
    systemPromptSnapshot: "line one\nline two",
    ...over,
  };
}

describe("CompareRunsModal", () => {
  it("renders metric deltas between the two runs", () => {
    const older = group({ version: 1, aggregate: { recall: 0.5, precision: 0.6, citation_accuracy: 0.7 } });
    const newer = group({ version: 2, aggregate: { recall: 0.9, precision: 0.4, citation_accuracy: 0.7 } });
    renderWithIntl(<CompareRunsModal agentId="ag1" older={older} newer={newer} onClose={vi.fn()} />);
    expect(screen.getByText("50%")).toBeInTheDocument(); // older recall
    expect(screen.getByText("90%")).toBeInTheDocument(); // newer recall
  });

  it("renders added/removed/unchanged lines in the system-prompt diff", () => {
    const older = group({ version: 1, systemPromptSnapshot: "keep this\nremove this" });
    const newer = group({ version: 2, systemPromptSnapshot: "keep this\nadd this" });
    renderWithIntl(<CompareRunsModal agentId="ag1" older={older} newer={newer} onClose={vi.fn()} />);
    expect(screen.getByText(/remove this/)).toBeInTheDocument();
    expect(screen.getByText(/add this/)).toBeInTheDocument();
    expect(screen.getByText(/keep this/)).toBeInTheDocument();
  });

  it('shows "not captured for this run" instead of crashing when a snapshot is null', () => {
    const older = group({ version: 1, systemPromptSnapshot: null });
    const newer = group({ version: 2, systemPromptSnapshot: "a fresh prompt" });
    renderWithIntl(<CompareRunsModal agentId="ag1" older={older} newer={newer} onClose={vi.fn()} />);
    expect(screen.getByText(/Not captured for this run/)).toBeInTheDocument();
    expect(screen.getByText("a fresh prompt")).toBeInTheDocument();
  });

  it("Promote calls useUpdateAgent with the selected run's system_prompt_snapshot", async () => {
    const older = group({ version: 1, systemPromptSnapshot: "old prompt" });
    const newer = group({ version: 2, systemPromptSnapshot: "new prompt" });
    renderWithIntl(<CompareRunsModal agentId="ag1" older={older} newer={newer} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Promote v1"));
    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({ id: "ag1", patch: { system_prompt: "old prompt" } }),
    );
  });

  it("Promote is disabled for a side with no captured snapshot", () => {
    const older = group({ version: 1, systemPromptSnapshot: null });
    const newer = group({ version: 2, systemPromptSnapshot: "new prompt" });
    renderWithIntl(<CompareRunsModal agentId="ag1" older={older} newer={newer} onClose={vi.fn()} />);
    expect(screen.getByText("Promote v1").closest("button")).toBeDisabled();
    expect(screen.getByText("Promote v2").closest("button")).not.toBeDisabled();
  });
});
