import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";

// Inlined (not imported from messages/en/shell.json) to avoid depending on a
// fragile `../` depth count from this deeply-nested feature folder — only
// the two keys FileCard/DiffViewer actually read are needed here.
const shellMessages = {
  diffViewer: {
    noDiffText: "No diff text available (binary or unfetched patch).",
    noChangedFiles: "No changed files.",
  },
};

let mockSmartDiff: SmartDiff | undefined;

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: () => ({ data: mockSmartDiff, isLoading: false, isError: false }),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function prFile(overrides: Partial<PrFile> = {}): PrFile {
  return { path: "src/service.ts", additions: 10, deletions: 2, patch: null, ...overrides };
}

function smartDiff(overrides: Partial<SmartDiff> = {}): SmartDiff {
  return {
    groups: [
      {
        role: "core",
        files: [
          {
            path: "src/service.ts",
            pseudocode_summary: null,
            additions: 10,
            deletions: 2,
            findings: [{ id: "f1", line: 12, severity: "WARNING" }],
          },
        ],
      },
      {
        role: "wiring",
        files: [
          {
            path: "src/index.ts",
            pseudocode_summary: null,
            additions: 2,
            deletions: 0,
            findings: [],
          },
        ],
      },
      {
        role: "boilerplate",
        files: [
          {
            path: "package-lock.json",
            pseudocode_summary: null,
            additions: 900,
            deletions: 800,
            findings: [],
          },
        ],
      },
    ],
    split_suggestion: { too_big: false, total_lines: 914, proposed_splits: [] },
    ...overrides,
  };
}

describe("SmartDiffViewer", () => {
  it("starts boilerplate collapsed and core/wiring expanded", () => {
    mockSmartDiff = smartDiff();
    renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
      />,
    );

    // core/wiring files are rendered (their FileCard headers are visible).
    expect(screen.getByText("src/service.ts")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    // boilerplate group is collapsed — its file isn't rendered yet.
    expect(screen.queryByText("package-lock.json")).not.toBeInTheDocument();
    // ...but its group header (with file count) is — exact text, since the
    // header's own ancestor div's full textContent (title + description
    // concatenated) would also substring-match a looser query.
    expect(screen.getByText("Boilerplate · 1 file")).toBeInTheDocument();
  });

  it("renders a clickable findings badge only when findings is non-empty", () => {
    mockSmartDiff = smartDiff();
    renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
      />,
    );

    const badge = screen.getByRole("button", { name: /1 finding/i });
    expect(badge).toBeInTheDocument();
    // src/index.ts (wiring, no findings) must not get a badge.
    expect(screen.queryByRole("button", { name: /0 finding/i })).not.toBeInTheDocument();

    fireEvent.click(badge);
    // Clicking doesn't throw and the file card stays rendered.
    expect(screen.getByText("src/service.ts")).toBeInTheDocument();
  });

  it("clicking a findings badge calls onOpenFinding with that file's first finding id", () => {
    mockSmartDiff = smartDiff();
    const onOpenFinding = vi.fn();
    renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
        onOpenFinding={onOpenFinding}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /1 finding/i }));
    expect(onOpenFinding).toHaveBeenCalledWith("f1");
  });

  it("renders an inline severity badge on the exact line a finding is anchored to", () => {
    mockSmartDiff = smartDiff();
    const patch = ["@@ -10,3 +10,3 @@", " ctx line 10", " ctx line 11", "+added line 12"].join("\n");
    renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[
          prFile({ path: "src/service.ts", patch }),
          prFile({ path: "src/index.ts" }),
          prFile({ path: "package-lock.json" }),
        ]}
      />,
    );

    // Line 12 (the finding's line) carries an inline "warning" severity badge.
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("expanding the boilerplate group renders its file", () => {
    mockSmartDiff = smartDiff();
    renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Boilerplate/i }));
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
  });

  it("SPEC-04 AC-20 — a focusFile pointing into the still-collapsed boilerplate group auto-expands that group and renders/scrolls to its file", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    mockSmartDiff = smartDiff();
    const { rerender } = renderWithIntl(
      <SmartDiffViewer
        prId="pr-1"
        files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
      />,
    );

    // Starts collapsed, per the "starts boilerplate collapsed" test above —
    // no click on the group header this time, only a focusFile prop change.
    expect(screen.queryByText("package-lock.json")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <SmartDiffViewer
          prId="pr-1"
          files={[prFile({ path: "src/service.ts" }), prFile({ path: "src/index.ts" }), prFile({ path: "package-lock.json" })]}
          focusFile={{ path: "package-lock.json", line: null, n: 1 }}
        />
      </NextIntlClientProvider>,
    );

    // The group auto-expanded — its file is now rendered — and the matching
    // FileCard's own card-level scrollIntoView fired (block: "start").
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    spy.mockRestore();
  });
});
