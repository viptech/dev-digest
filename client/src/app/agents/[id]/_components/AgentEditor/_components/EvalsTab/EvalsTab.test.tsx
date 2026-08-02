import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/eval.json";

const runMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useEvalCases: () => ({
    data: [{ id: "c1", owner_kind: "agent", owner_id: "ag1", name: "stripe-key-leak", input_diff: "", input_files: null, input_meta: null, expected_output: [], notes: null }],
    isLoading: false,
  }),
  useRunEvalCase: () => ({ mutate: runMutate, isPending: false, data: undefined }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("lists eval cases", () => {
    renderWithIntl(<EvalsTab agentId="ag1" />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
  });

  it("clicking Run triggers useRunEvalCase with the case id", () => {
    renderWithIntl(<EvalsTab agentId="ag1" />);
    fireEvent.click(screen.getByText("Run"));
    expect(runMutate).toHaveBeenCalledWith("c1");
  });
});
