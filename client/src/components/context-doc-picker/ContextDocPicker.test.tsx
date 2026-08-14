import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AttachedContextDoc } from "./ContextDocPicker";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/projectContext.json";

const setDocs = vi.fn();

const REPOS = {
  repo1: { id: "repo1", owner: "acme", name: "payments-api", full_name: "acme/payments-api" },
  repo2: { id: "repo2", owner: "acme", name: "platform-specs", full_name: "acme/platform-specs" },
  repo3: { id: "repo3", owner: "acme", name: "billing-worker", full_name: "acme/billing-worker" },
};

// Discovery always follows the app's already-active repo (no in-picker
// selector — removed per user feedback: duplicating the sidebar's
// workspace-switcher choice here was confusing). Each test sets this to
// whichever repo it wants the discovery table to show.
let mockActiveRepoId: keyof typeof REPOS | null = "repo1";

vi.mock("../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: mockActiveRepoId ? REPOS[mockActiveRepoId] : null }),
}));

const repo1Docs = [
  { path: "specs/public-api.md", category: "specs", chars: 40, used_by_agents: 2 },
  { path: "docs/architecture.md", category: "docs", chars: 20, used_by_agents: 0 },
];
const repo2Docs = [{ path: "specs/rate-limiting.md", category: "specs", chars: 30, used_by_agents: 1 }];
// A root-level INSIGHTS.md-style doc — outside specs/docs/insights, no
// directory ancestor OR filename-stem match — surfaces as category 'other'.
const repo3Docs = [{ path: "README.md", category: "other", chars: 15, used_by_agents: 0 }];

function docsForRepo(repoId: string | null | undefined) {
  return repoId === "repo1" ? repo1Docs : repoId === "repo2" ? repo2Docs : repoId === "repo3" ? repo3Docs : [];
}

vi.mock("../../lib/hooks/project-context", () => ({
  useRepoContextDocs: (repoId: string | null | undefined) => ({ data: docsForRepo(repoId) }),
  useContextDocContent: () => ({ data: undefined, isLoading: false }),
  // Data-driven (not a blind empty Map) — AC-5's live token counter needs
  // real per-doc chars to be exercised meaningfully by a test.
  useContextDocsCharsMap: (repoIds: string[]) => {
    const map = new Map<string, number>();
    for (const repoId of repoIds) {
      for (const d of docsForRepo(repoId)) map.set(`${repoId}:${d.path}`, d.chars);
    }
    return map;
  },
  approxTokens: (chars: number) => Math.ceil(chars / 4),
  CLIENT_CONTEXT_BUDGET_CHARS_WARNING: 24000,
}));

import { ContextDocPicker } from "./ContextDocPicker";

afterEach(() => {
  cleanup();
  mockActiveRepoId = "repo1";
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ContextDocPicker", () => {
  it("shows the attached count and every attached doc's repo tag", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    expect(screen.getByText("1 attached")).toBeInTheDocument();
    expect(screen.getAllByText("acme/payments-api").length).toBeGreaterThan(0);
  });

  it("has no repo-selector — discovery always names the app's active repo as plain text, not a dropdown", () => {
    renderWithIntl(<ContextDocPicker attachedDocs={[]} onSetDocs={setDocs} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByText("acme/payments-api").length).toBeGreaterThan(0);
  });

  it(
    "discovery follows the app's active repo, NOT whichever repo an already-" +
      "attached doc happens to belong to (the point of removing the selector)",
    () => {
      mockActiveRepoId = "repo2";
      renderWithIntl(
        <ContextDocPicker
          attachedDocs={[
            // Attached from repo1 — but the ACTIVE repo is repo2, so the
            // discovery table below must show repo2's docs, not repo1's.
            { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
          ]}
          onSetDocs={setDocs}
        />,
      );
      expect(screen.getByText("specs/rate-limiting.md")).toBeInTheDocument();
      expect(screen.queryByText("docs/architecture.md")).not.toBeInTheDocument();
    },
  );

  it("shows an 'N of M attached' badge scoped to the active repo's discovery table (AC-4b)", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    // repo1 (active) has 2 discovered docs, 1 of them attached.
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("discovers a .md file outside specs/docs/insights and shows it with category 'other'", () => {
    mockActiveRepoId = "repo3";
    renderWithIntl(<ContextDocPicker attachedDocs={[]} onSetDocs={setDocs} />);
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("shows an empty-attached hint when nothing is attached yet", () => {
    renderWithIntl(<ContextDocPicker attachedDocs={[]} onSetDocs={setDocs} />);
    expect(screen.getByText(/pick some from the discovery list/i)).toBeInTheDocument();
  });

  it("checking a discovered doc calls onSetDocs with it appended (AC-4b)", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // First unchecked discovery row is docs/architecture.md.
    fireEvent.click(checkboxes[checkboxes.length - 1]!);
    expect(setDocs).toHaveBeenCalledWith([
      { repo_id: "repo1", path: "specs/public-api.md" },
      { repo_id: "repo1", path: "docs/architecture.md" },
    ]);
  });

  it("unchecking an attached doc in the discovery table calls onSetDocs without it (AC-4b)", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!); // specs/public-api.md, currently checked
    expect(setDocs).toHaveBeenCalledWith([]);
  });

  it(
    "recomputes the aggregate token estimate across all attached docs, " +
      "independent of repo, on every attach/detach (AC-5)",
    () => {
      const oneDoc: AttachedContextDoc[] = [
        { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
      ];
      const { rerender } = renderWithIntl(
        <ContextDocPicker attachedDocs={oneDoc} onSetDocs={setDocs} />,
      );
      // specs/public-api.md is 40 chars → ceil(40/4) = 10 tokens.
      expect(screen.getByText("≈ 10 tokens")).toBeInTheDocument();

      // Simulate the round-trip after attaching a SECOND doc from a
      // DIFFERENT repo (repo2, 30 chars) — total 70 chars → ceil(70/4) = 18.
      const twoDocs: AttachedContextDoc[] = [
        ...oneDoc,
        { repo_id: "repo2", path: "specs/rate-limiting.md", order: 1, owner: "acme", name: "platform-specs" },
      ];
      rerender(
        <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
          <ContextDocPicker attachedDocs={twoDocs} onSetDocs={setDocs} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText("≈ 18 tokens")).toBeInTheDocument();
      expect(screen.queryByText("≈ 10 tokens")).not.toBeInTheDocument();
    },
  );

  it("dragging an attached row to a new position emits the reordered set (AC-6)", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
          { repo_id: "repo1", path: "docs/architecture.md", order: 1, owner: "acme", name: "payments-api" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    // Both attached rows are draggable divs (react draggable="true"); the
    // component tracks drag purely via onDragStart/onDragOver/onDrop
    // (no native DataTransfer payload), so plain fireEvent works.
    const rows = document.querySelectorAll('[draggable="true"]');
    expect(rows).toHaveLength(2);
    fireEvent.dragStart(rows[0]!); // pick up specs/public-api.md (index 0)
    fireEvent.dragOver(rows[1]!);
    fireEvent.drop(rows[1]!); // drop onto docs/architecture.md's slot (index 1)
    expect(setDocs).toHaveBeenCalledWith([
      { repo_id: "repo1", path: "docs/architecture.md" },
      { repo_id: "repo1", path: "specs/public-api.md" },
    ]);
  });

  it("detaching a row via its detach button calls onSetDocs without it (regardless of repo)", () => {
    renderWithIntl(
      <ContextDocPicker
        attachedDocs={[
          { repo_id: "repo1", path: "specs/public-api.md", order: 0, owner: "acme", name: "payments-api" },
          { repo_id: "repo2", path: "specs/rate-limiting.md", order: 1, owner: "acme", name: "platform-specs" },
        ]}
        onSetDocs={setDocs}
      />,
    );
    const detachButtons = screen.getAllByLabelText("Detach");
    fireEvent.click(detachButtons[1]!); // detach the repo2 doc
    expect(setDocs).toHaveBeenCalledWith([{ repo_id: "repo1", path: "specs/public-api.md" }]);
  });
});
