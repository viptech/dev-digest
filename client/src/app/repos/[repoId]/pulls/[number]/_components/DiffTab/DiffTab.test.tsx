import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";

// Inlined (not imported from messages/en/shell.json) to avoid depending on a
// fragile `../` depth count — only the two keys FileCard/DiffViewer actually
// read are needed here.
const messages = {
  diffViewer: {
    noDiffText: "No diff text available (binary or unfetched patch).",
    noChangedFiles: "No changed files.",
  },
};

const smartDiff: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/service.ts", pseudocode_summary: null, additions: 10, deletions: 2, findings: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 12, proposed_splits: [] },
};

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSmartDiff: () => ({ data: smartDiff, isLoading: false, isError: false }),
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const FILES: PrFile[] = [{ path: "src/service.ts", additions: 10, deletions: 2, patch: null }];

describe("DiffTab", () => {
  it("defaults to Smart order and shows the Smart Diff grouping", () => {
    renderWithIntl(<DiffTab prId="pr-1" filesCount={1} files={FILES} />);
    expect(screen.getByText("Core logic · 1 file")).toBeInTheDocument();
  });

  it("switching to Original order falls back to the plain file list", () => {
    renderWithIntl(<DiffTab prId="pr-1" filesCount={1} files={FILES} />);
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    // The Smart Diff group header is gone; the plain FileCard for the same
    // file is rendered directly without role grouping.
    expect(screen.queryByText("Core logic · 1 file")).not.toBeInTheDocument();
    expect(screen.getByText("src/service.ts")).toBeInTheDocument();
  });

  it("SPEC-04 T10 — a focusFile prop routes to the matching FileCard's new focus prop, not the old, still-unused scrollToLine prop", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderWithIntl(
      <DiffTab
        prId="pr-1"
        filesCount={1}
        files={FILES}
        focusFile={{ path: "src/service.ts", line: null, n: 1 }}
      />,
    );
    // The matching file's card scrolled into view (block: "start" — the
    // NEW file-level `focus` mechanism, not the old per-line `scrollToLine`
    // one, which never fires a card-level scroll at all).
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    spy.mockRestore();
  });
});
