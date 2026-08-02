import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/eval.json";

const runMutateAsync = vi.fn().mockResolvedValue(undefined);
const delMutateAsync = vi.fn().mockResolvedValue(undefined);
let cases: unknown[] = [
  {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
    last_run: null,
  },
];

vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false, data: undefined }),
  useDeleteEvalCase: () => ({ mutateAsync: delMutateAsync, isPending: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runMutateAsync.mockClear();
  delMutateAsync.mockClear();
});

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

  it("shows 'never run' badge for a case with no last_run", () => {
    renderWithIntl(<EvalsTab agentId="ag1" />);
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("shows a passed/failed badge for a case with a last_run", () => {
    cases = [
      {
        id: "c1",
        owner_kind: "agent",
        owner_id: "ag1",
        name: "stripe-key-leak",
        input_diff: "",
        input_files: null,
        input_meta: null,
        expected_output: [],
        notes: null,
        last_run: { pass: true, recall: 1, ran_at: "2026-01-01T00:00:00.000Z" },
      },
    ];
    renderWithIntl(<EvalsTab agentId="ag1" />);
    expect(screen.getByText(/passed/)).toBeInTheDocument();
  });

  it("clicking Run triggers useRunEvalCase with the case id", () => {
    renderWithIntl(<EvalsTab agentId="ag1" />);
    fireEvent.click(screen.getByText("Run"));
    expect(runMutateAsync).toHaveBeenCalledWith("c1");
  });

  it("shows an inline error when running a case fails", async () => {
    runMutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderWithIntl(<EvalsTab agentId="ag1" />);
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(screen.getByText("Run failed. Please try again.")).toBeInTheDocument());
  });
});
