import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseDraft } from "@/lib/hooks/evals";
import messages from "../../../messages/en/eval.json";

const createMutate = vi.fn().mockResolvedValue({ id: "c1" });
const updateMutate = vi.fn().mockResolvedValue({ id: "c1" });
const runMutate = vi.fn().mockResolvedValue({
  case: {},
  run: { pass: true, traces_passed: 1, traces_total: 1, duration_ms: 8200, cost_usd: 0, per_trace: [{ pass: true, actual: [{ file: "a.ts" }] }] },
});
let runData: unknown = undefined;
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutate, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutate, isPending: false, data: runData }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  updateMutate.mockClear();
  runMutate.mockClear();
  runData = undefined;
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

  // ---- SPEC-05 T13: seeded-mode additions --------------------------------
  const DRAFT: EvalCaseDraft = {
    owner_id: "ag1",
    name: "From finding: Hardcoded secret",
    input_diff: "diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,2 +1,3 @@\n+leak",
    input_meta: null,
    expected_output: [{ type: "must_find", file: "src/config.ts", start_line: 11, end_line: 11, severity: "CRITICAL", category: "security" }],
  };

  it("shows the seeded subtitle when opened from a decided finding", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" draft={DRAFT} seededFrom="accepted" onClose={vi.fn()} />);
    expect(screen.getByText(/Seeded from a finding you accepted/)).toBeInTheDocument();
  });

  it("shows a POSITIVE CASE badge with a human summary for a single must_find expectation", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" draft={DRAFT} seededFrom="accepted" onClose={vi.fn()} />);
    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(screen.getByText(/MUST find src\/config\.ts:11/)).toBeInTheDocument();
  });

  it("shows a NEGATIVE CASE badge for a single must_not_flag expectation", () => {
    const dismissedDraft: EvalCaseDraft = {
      ...DRAFT,
      expected_output: [{ type: "must_not_flag", file: "src/config.ts", start_line: 11, end_line: 11, severity: "CRITICAL", category: "security" }],
    };
    renderWithIntl(<EvalCaseModal agentId="ag1" draft={dismissedDraft} seededFrom="dismissed" onClose={vi.fn()} />);
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText(/MUST NOT flag src\/config\.ts:11/)).toBeInTheDocument();
  });

  it("shows the Actual output panel with the run's JSON after Run case, and a run-status banner", async () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" draft={DRAFT} seededFrom="accepted" onClose={vi.fn()} />);
    expect(screen.getByText("Run this case to see its actual findings here.")).toBeInTheDocument();

    runData = {
      case: {},
      run: { pass: true, traces_passed: 1, traces_total: 1, duration_ms: 8200, cost_usd: 0, per_trace: [{ pass: true, actual: [{ file: "a.ts" }] }] },
    };
    fireEvent.click(screen.getByText("Run case"));
    await waitFor(() => expect(runMutate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/"file": "a\.ts"/)).toBeInTheDocument());
  });

  it("Finding skeleton appends a template EvalExpectation to the expected-output JSON", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Finding skeleton"));
    const jsonBoxes = screen.getAllByRole("textbox");
    const expectedBox = jsonBoxes[jsonBoxes.length - 1] as HTMLTextAreaElement;
    const parsed = JSON.parse(expectedBox.value);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: "must_find", severity: "WARNING" });
  });

  it("Run on save makes Save behave like Run case (saves then runs)", async () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    await waitFor(() => expect(runMutate).toHaveBeenCalledWith("c1"));
  });

  it("Files tab lists the distinct file paths parsed from the diff", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" draft={DRAFT} seededFrom="accepted" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Files"));
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
  });

  it("Files tab shows an empty state when the diff has no file headers", () => {
    renderWithIntl(<EvalCaseModal agentId="ag1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Files"));
    expect(screen.getByText("No files parsed from this diff yet.")).toBeInTheDocument();
  });
});
