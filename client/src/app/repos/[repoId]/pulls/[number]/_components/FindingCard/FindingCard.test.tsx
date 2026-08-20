import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// `@/lib/toast`'s factory assigns these directly as object property values
// (not inside a lazily-invoked nested function like the evals mock below),
// so it reads them at mock-evaluation time — which, per FindingCard.tsx's
// own top-level `import { notify } from "@/lib/toast"`, happens while this
// test file's import graph is still resolving, before a plain top-level
// `const` here would have run. `vi.hoisted()` initializes them early enough
// to be safe either way (vitest: "no top level variables inside [a vi.mock
// factory], since this call is hoisted to top of the file").
const { createEvalCaseMutateAsync, toastSuccess, toastError } = vi.hoisted(() => ({
  createEvalCaseMutateAsync: vi.fn().mockResolvedValue({
    owner_id: "ag1",
    name: "From finding: Hardcoded Stripe secret key",
    input_diff: "",
    input_meta: null,
    expected_output: [{ type: "must_find", file: "src/config.ts", start_line: 11, end_line: 11, severity: "CRITICAL", category: "security" }],
  }),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: createEvalCaseMutateAsync, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  notify: { success: toastSuccess, error: toastError },
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  createEvalCaseMutateAsync.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("forceFocus expands a collapsed card", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} forceFocus focusNonce={1} />);
    // The suggestion block only renders once expanded.
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("'Turn into eval case' is disabled when the finding has no accept/dismiss decision yet (AC-2)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case").closest("button")).toBeDisabled();
  });

  it("'Turn into eval case' is enabled once the finding is accepted, fetches a draft, and opens it via onOpenEvalCaseDraft (SPEC-05 T13 — no immediate persist, no toast)", async () => {
    const onOpenEvalCaseDraft = vi.fn();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-08-19T00:00:00.000Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onAction={() => {}} onOpenEvalCaseDraft={onOpenEvalCaseDraft} />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(createEvalCaseMutateAsync).toHaveBeenCalledWith("f1"));
    // T13: the draft is handed to the caller to open in EvalCaseModal — no
    // row was persisted, no success toast/deep-link (that was the round-2
    // fix this addendum supersedes).
    await waitFor(() =>
      expect(onOpenEvalCaseDraft).toHaveBeenCalledWith(
        expect.objectContaining({ owner_id: "ag1" }),
        "accepted",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("passes seededFrom: 'dismissed' for a dismissed finding", async () => {
    const onOpenEvalCaseDraft = vi.fn();
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-08-19T00:00:00.000Z" };
    renderWithIntl(
      <FindingCard f={dismissed} defaultExpanded onAction={() => {}} onOpenEvalCaseDraft={onOpenEvalCaseDraft} />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
    await waitFor(() => expect(onOpenEvalCaseDraft).toHaveBeenCalledWith(expect.anything(), "dismissed"));
  });

  it("shows an error toast when creating the eval case fails", async () => {
    createEvalCaseMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-08-19T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
