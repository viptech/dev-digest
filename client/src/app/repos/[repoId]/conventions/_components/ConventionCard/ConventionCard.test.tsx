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
  evidence_path: "src/service.ts",
  evidence_snippet: "constructor(private container: Container) {}",
  confidence: 0.9,
  accepted: false,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders rule + evidence + confidence", () => {
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onAccept={vi.fn()} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText(/src\/service\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
  });

  it("shows an Accepted badge instead of the accept button when accepted", () => {
    renderWithIntl(<ConventionCard candidate={{ ...CANDIDATE, accepted: true }} onAccept={vi.fn()} />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("calls onAccept when the accept button is clicked", () => {
    const onAccept = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onAccept).toHaveBeenCalled();
  });
});
