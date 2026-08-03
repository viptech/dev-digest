import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/eval.json";

const createMutate = vi.fn().mockResolvedValue({ id: "c1" });
const updateMutate = vi.fn().mockResolvedValue({ id: "c1" });
const runMutate = vi.fn().mockResolvedValue({ case: {}, run: { per_trace: [{ pass: true }] } });
vi.mock("../../../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutate, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutate, isPending: false, data: undefined }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  updateMutate.mockClear();
  runMutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseModal", () => {
  it("Save is disabled without a name", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("Save is disabled when the expected-output JSON is invalid", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    const jsonBoxes = screen.getAllByRole("textbox");
    fireEvent.change(jsonBoxes[jsonBoxes.length - 1]!, { target: { value: "{not json" } });
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
  });

  it("saving a valid case calls useCreateEvalCase", async () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    expect(createMutate).toHaveBeenCalled();
  });

  it("Run case is available for a brand-new (unsaved) case and saves before running", async () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.click(screen.getByText("Run case"));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    await waitFor(() => expect(runMutate).toHaveBeenCalledWith("c1"));
  });

  it("shows an inline error and keeps the modal open when save fails", async () => {
    createMutate.mockRejectedValueOnce(new Error("boom"));
    const onClose = vi.fn();
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Couldn't save this eval case. Please try again.")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
