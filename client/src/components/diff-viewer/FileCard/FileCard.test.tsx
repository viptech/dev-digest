import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";

// Inlined (not imported from messages/en/shell.json), same precedent
// DiffTab.test.tsx already uses — only the two keys FileCard actually reads.
const messages = {
  diffViewer: {
    noDiffText: "No diff text available (binary or unfetched patch).",
    noChangedFiles: "No changed files.",
  },
};

import { FileCard } from "./FileCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// additions(300) + deletions(0) > AUTO_EXPAND_MAX_LINES(200) — starts CLOSED
// by default, so the `focus`-prop force-open tests actually prove something.
const PATCH = ["@@ -1,3 +1,4 @@", " line1", "+line2 new", " line3"].join("\n");
const FILE: PrFile = { path: "src/large.ts", additions: 300, deletions: 0, patch: PATCH };

describe("FileCard — SPEC-04 T10 focus prop", () => {
  it("a focus prop with a non-null line force-opens the card, scrolls its own ref, and highlights that exact CodeLine", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderWithIntl(<FileCard file={FILE} focus={{ line: 2, n: 1 }} />);

    // Force-opened despite exceeding AUTO_EXPAND_MAX_LINES.
    expect(screen.getByText("line2 new")).toBeInTheDocument();
    // Card-level scrollIntoView (block: "start") fired at least once.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    // Line-level scrollIntoView (block: "center", from CodeLine's own effect)
    // also fired — the highlighted line scrolled into view too.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    spy.mockRestore();
  });

  it("a focus prop with line: null still force-opens and scrolls the CARD, but highlights no individual line — B2 regression", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderWithIntl(<FileCard file={FILE} focus={{ line: null, n: 1 }} />);

    expect(screen.getByText("line2 new")).toBeInTheDocument(); // still opened
    // Only the card-level (block: "start") call fired — no line-level
    // (block: "center") highlight call, since no line matched.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    spy.mockRestore();
  });

  it("clicking the same target twice (same path/line, incremented n) re-triggers scrollIntoView both times — B3 nonce regression", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const { rerender } = renderWithIntl(<FileCard file={FILE} focus={{ line: 2, n: 1 }} />);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same line, same path — only `n` changes, mirroring a second click on
    // the identical ReviewFocusCard row. A naive `[focus.line]`-keyed effect
    // would NOT re-fire here, since `line` didn't change between the calls.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
        <FileCard file={FILE} focus={{ line: 2, n: 2 }} />
      </NextIntlClientProvider>,
    );
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    spy.mockRestore();
  });

  it("no focus prop leaves a large file collapsed by default", () => {
    renderWithIntl(<FileCard file={FILE} />);
    expect(screen.queryByText("line2 new")).not.toBeInTheDocument();
  });
});
