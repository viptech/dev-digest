import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/eval.json";

const createMutate = vi.fn().mockResolvedValue({ id: "c1" });
vi.mock("../../../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(cleanup);

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
});
