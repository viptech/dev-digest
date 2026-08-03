import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  rule: "Services take a Container in the constructor.",
  category: "Structure",
  evidence_path: "src/service.ts",
  evidence_snippet: "constructor(private container: Container) {}",
  evidence_line: 12,
  confidence: 0.9,
  accepted: false,
  status: "pending",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders rule + evidence + confidence + category badge", () => {
    renderWithIntl(
      <ConventionCard candidate={CANDIDATE} onSetStatus={vi.fn()} onSaveRule={vi.fn()} />,
    );
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText(/src\/service\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
    expect(screen.getByText("Structure")).toBeInTheDocument();
  });

  it("shows an Accepted badge when accepted", () => {
    renderWithIntl(
      <ConventionCard
        candidate={{ ...CANDIDATE, status: "accepted" }}
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
      />,
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("calls onSetStatus('accepted') when the accept button is clicked", () => {
    const onSetStatus = vi.fn();
    renderWithIntl(
      <ConventionCard candidate={CANDIDATE} onSetStatus={onSetStatus} onSaveRule={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Accept as Skill"));
    expect(onSetStatus).toHaveBeenCalledWith("accepted");
  });

  it("calls onSetStatus('rejected') when the reject button is clicked", () => {
    const onSetStatus = vi.fn();
    renderWithIntl(
      <ConventionCard candidate={CANDIDATE} onSetStatus={onSetStatus} onSaveRule={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Reject"));
    expect(onSetStatus).toHaveBeenCalledWith("rejected");
  });

  it("shows the error message when passed one", () => {
    renderWithIntl(
      <ConventionCard
        candidate={CANDIDATE}
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
        error="Couldn't accept — try again."
      />,
    );
    expect(screen.getByText("Couldn't accept — try again.")).toBeInTheDocument();
  });

  it("edits and saves the rule, calling onSaveRule with the new text", () => {
    const onSaveRule = vi.fn();
    renderWithIntl(
      <ConventionCard candidate={CANDIDATE} onSetStatus={vi.fn()} onSaveRule={onSaveRule} />,
    );
    fireEvent.click(screen.getByText("Edit"));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Updated rule text." } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveRule).toHaveBeenCalledWith("Updated rule text.");
    // exits edit mode (textarea no longer rendered)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a GitHub link when repoFullName/defaultBranch/evidence_line are all present", () => {
    renderWithIntl(
      <ConventionCard
        candidate={CANDIDATE}
        repoFullName="acme/demo"
        defaultBranch="main"
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /src\/service\.ts:12/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/demo/blob/main/src/service.ts#L12");
  });

  it("renders plain text (no link) when repoFullName is missing", () => {
    renderWithIntl(
      <ConventionCard
        candidate={CANDIDATE}
        defaultBranch="main"
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/src\/service\.ts:12/)).toBeInTheDocument();
  });

  it("renders plain text (no link) when defaultBranch is missing", () => {
    renderWithIntl(
      <ConventionCard
        candidate={CANDIDATE}
        repoFullName="acme/demo"
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders plain text (no link) when evidence_line is missing", () => {
    renderWithIntl(
      <ConventionCard
        candidate={{ ...CANDIDATE, evidence_line: null }}
        repoFullName="acme/demo"
        defaultBranch="main"
        onSetStatus={vi.fn()}
        onSaveRule={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
