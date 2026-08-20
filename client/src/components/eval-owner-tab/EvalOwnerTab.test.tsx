import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";

const runMutateAsync = vi.fn().mockResolvedValue(undefined);
const delMutateAsync = vi.fn().mockResolvedValue(undefined);
const runSetMutateAsync = vi.fn().mockResolvedValue(undefined);

function evalCase(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

let cases: unknown[] = [evalCase()];
let historyRows: unknown[] = [];

// Moved from `agents/[id]/.../AgentEditor/_components/EvalsTab/EvalsTab.test.tsx`
// (Development Plan `skill-editor.md` Step 5, SPEC-06 T8/AC-17) — mocked via
// the `@/` alias (not a counted `../` chain, client/INSIGHTS.md 2026-08-02).
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false, data: undefined }),
  useDeleteEvalCase: () => ({ mutateAsync: delMutateAsync, isPending: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvalSet: () => ({ mutateAsync: runSetMutateAsync, isPending: false }),
  useEvalRunHistory: () => ({ data: historyRows }),
}));

import { EvalOwnerTab } from "./EvalOwnerTab";

afterEach(() => {
  cleanup();
  runMutateAsync.mockClear();
  delMutateAsync.mockClear();
  runSetMutateAsync.mockClear();
  cases = [evalCase()];
  historyRows = [];
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function runRecord(over: Record<string, unknown> = {}) {
  return {
    id: `r-${Math.random()}`,
    case_id: "c1",
    case_name: "stripe-key-leak",
    run_group_id: "g1",
    ran_at: "2026-08-01T00:00:00.000Z",
    actual_output: [],
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 100,
    cost_usd: 0.01,
    ...over,
  };
}

describe("EvalOwnerTab", () => {
  it("lists eval cases", () => {
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
  });

  it("shows 'never run' badge and the 'expected N findings' subtitle for a case with no last_run", () => {
    cases = [evalCase({ expected_output: [{ type: "must_find", file: "src/a.ts" }] })];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding(s)")).toBeInTheDocument();
  });

  it("shows the 'expected N, got M' subtitle for a case with a last_run (actual_count)", () => {
    cases = [
      evalCase({
        expected_output: [{ type: "must_find", file: "src/a.ts" }],
        last_run: { pass: true, recall: 1, ran_at: "2026-01-01T00:00:00.000Z", actual_count: 1 },
      }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("expected 1 finding(s), got 1")).toBeInTheDocument();
  });

  it("shows the MUST FIND badge and a 'SEVERITY - category' tag for a must_find expectation", () => {
    cases = [
      evalCase({
        expected_output: [
          { type: "must_find", file: "src/a.ts", start_line: 10, end_line: 10, severity: "CRITICAL", category: "security" },
        ],
        last_run: { pass: true, recall: 1, ran_at: "2026-01-01T00:00:00.000Z", actual_count: 1 },
      }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("MUST FIND")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL - security")).toBeInTheDocument();
  });

  it("shows the MUST NOT FLAG badge and 'assert empty' for a must_not_flag-only expected_output", () => {
    cases = [evalCase({ expected_output: [{ type: "must_not_flag", file: "src/a.ts" }] })];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("MUST NOT FLAG")).toBeInTheDocument();
    expect(screen.getByText("assert empty")).toBeInTheDocument();
  });

  it("shows neither badge nor tag for a case with an empty expected_output", () => {
    cases = [evalCase({ expected_output: [] })];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.queryByText("MUST FIND")).not.toBeInTheDocument();
    expect(screen.queryByText("MUST NOT FLAG")).not.toBeInTheDocument();
    expect(screen.queryByText("assert empty")).not.toBeInTheDocument();
    expect(screen.getByText("expected 0 finding(s)")).toBeInTheDocument();
  });

  it("shows the passing-count badge and cases counter", () => {
    cases = [
      evalCase({ id: "c1", last_run: { pass: true, recall: 1, ran_at: "2026-01-01T00:00:00.000Z", actual_count: 1 } }),
      evalCase({ id: "c2", name: "phantom-api-call", last_run: { pass: false, recall: 0, ran_at: "2026-01-01T00:00:00.000Z", actual_count: 0 } }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("1 / 2 passing")).toBeInTheDocument();
    expect(screen.getByText("2 cases")).toBeInTheDocument();
  });

  it("clicking the Run icon-button triggers useRunEvalCase with the case id", () => {
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(runMutateAsync).toHaveBeenCalledWith("c1");
  });

  it("shows an inline error when running a case fails", async () => {
    runMutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByText("Run failed. Please try again.")).toBeInTheDocument());
  });

  it("'Run all' triggers the bulk set-run mutation", () => {
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    fireEvent.click(screen.getByText("Run all"));
    expect(runSetMutateAsync).toHaveBeenCalled();
  });

  it("no history yet → no metrics-card block, empty state, no compare prompt, no regression indicator", () => {
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.queryByText("RECALL")).not.toBeInTheDocument();
    expect(screen.getByText(/No set-runs yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Select exactly two/)).not.toBeInTheDocument();
    expect(screen.queryByText("Comparing set-runs")).not.toBeInTheDocument();
  });

  it("a single set-run renders in history with NO regression/improved indicator (AC-25)", () => {
    // Two eval cases defined but only one ran in this historical set-run —
    // keeps the header's "{count} cases" and the history row's own
    // "{count} cases" (same translation format, different counters)
    // from colliding on identical text (client/INSIGHTS.md 2026-07-31
    // gotcha: duplicate fixture text breaks exact-match getByText).
    cases = [evalCase({ id: "c1" }), evalCase({ id: "c2", name: "phantom-api-call" })];
    historyRows = [runRecord({ id: "r1", run_group_id: "g1" })];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("2 cases")).toBeInTheDocument();
    expect(screen.getByText("1 cases")).toBeInTheDocument();
    // Only one run_group exists — comparison view (and any delta arrow) must not render.
    expect(screen.queryByText("Comparing set-runs")).not.toBeInTheDocument();
    expect(screen.getByText(/Select exactly two/)).toBeInTheDocument();
  });

  it("selecting two set-runs shows per-metric deltas and per-case pass/fail transitions (AC-18/AC-19)", () => {
    historyRows = [
      runRecord({ id: "r1-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", pass: true, recall: 1, precision: 1 }),
      runRecord({ id: "r1-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z", pass: false, recall: 1, precision: 0.5 }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);
    const checkboxes = screen.getAllByLabelText("Select to compare");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    expect(screen.getByText("Comparing set-runs")).toBeInTheDocument();
    // Scoped to the compare section: with only 2 set-runs total, the
    // selected pair is also the latest-vs-previous pair the metrics-card
    // block up top renders its own delta for — an unscoped getByText would
    // match both (same class of duplicate-text pitfall as client/INSIGHTS.md
    // 2026-08-19's Badge gotcha, here from two legitimately separate UI
    // sections showing the same delta value rather than from one element).
    const compareSection = screen.getByText("Comparing set-runs").closest("div")!;
    // precision dropped 100% → 50%: a Δ50% regression indicator renders.
    expect(within(compareSection).getByText(/Δ 50%/)).toBeInTheDocument();
    // Per-case transition: the same case (c1) flipped pass → fail.
    expect(screen.getByText("Per-case changes")).toBeInTheDocument();
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
  });

  it("renders a 4-card metrics block above the case list with values + deltas vs. the previous set-run", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", recall: 0.5, precision: 0.4, citation_accuracy: 0.3, pass: true }),
      runRecord({ id: "r-new", run_group_id: "g2", ran_at: "2026-08-10T00:00:00.000Z", recall: 1, precision: 0.8, citation_accuracy: 0.6, pass: true }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="agent" ownerId="ag1" />);

    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("TRACES PASSED")).toBeInTheDocument();

    // Latest set-run's (g2) values.
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();

    // Deltas vs. the previous set-run (g1).
    expect(screen.getByText(/Δ 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Δ 40%/)).toBeInTheDocument();
    expect(screen.getByText(/Δ 30%/)).toBeInTheDocument();

    expect(screen.getByText("View full dashboard →")).toBeInTheDocument();
  });

  // ---- SPEC-06 T8/AC-17 — skill-owner scenarios --------------------------
  it("skill owner: renders the same tab (cases, run all) with no crash and no agent-only dashboard link", () => {
    historyRows = [
      runRecord({ id: "r-old", run_group_id: "g1", ran_at: "2026-08-01T00:00:00.000Z", recall: 0.5, precision: 0.4, citation_accuracy: 0.3, pass: true }),
    ];
    renderWithIntl(<EvalOwnerTab ownerKind="skill" ownerId="sk1" />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    // AC-20 — the workspace Eval Dashboard stays agent-only; a skill-owned
    // tab must not link to a page that will never show its own data.
    expect(screen.queryByText("View full dashboard →")).not.toBeInTheDocument();
  });

  it("skill owner: 'Run all' still triggers the bulk set-run mutation (base path asserted in lib/hooks/evals.test.ts)", () => {
    renderWithIntl(<EvalOwnerTab ownerKind="skill" ownerId="sk1" />);
    fireEvent.click(screen.getByText("Run all"));
    expect(runSetMutateAsync).toHaveBeenCalled();
  });
});
