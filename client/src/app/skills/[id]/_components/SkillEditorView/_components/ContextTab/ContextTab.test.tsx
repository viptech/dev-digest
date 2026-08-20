import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/projectContext.json";

const setMutate = vi.fn();
const mockUseSkillContextDocs = vi.fn();

// Same mock-pattern as the agent editor's `ContextTab.test.tsx` — mock the
// hook layer via the `@/` alias (client INSIGHTS.md 2026-08-02/2026-08-19),
// let the real, already-tested `ContextDocPicker` render.
vi.mock("@/lib/hooks/skills", () => ({
  useSkillContextDocs: (...args: unknown[]) => mockUseSkillContextDocs(...args),
  useSetSkillContextDocs: () => ({ mutate: setMutate, isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo1", owner: "acme", name: "api", full_name: "acme/api" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  // A DIFFERENT path from the already-attached doc below — the discovery
  // table would otherwise render "specs/a.md" a second time (still-checked
  // row) and collide with `getByText("specs/a.md")` on the attached list.
  useRepoContextDocs: () => ({ data: [{ path: "docs/b.md", category: "docs", chars: 10, used_by_agents: 1 }] }),
  useContextDocContent: () => ({ data: undefined, isLoading: false }),
  useContextDocsCharsMap: () => new Map<string, number>(),
  approxTokens: (chars: number) => Math.ceil(chars / 4),
  CLIENT_CONTEXT_BUDGET_CHARS_WARNING: 24000,
}));

import { ContextTab } from "./ContextTab";

const attachedDoc = { skill_id: "sk1", repo_id: "repo1", path: "specs/a.md", order: 0, owner: "acme", name: "api" };

beforeEach(() => {
  mockUseSkillContextDocs.mockReturnValue({ data: [attachedDoc] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ContextTab (skill)", () => {
  it("renders the skill's attached document via the shared ContextDocPicker (AC-10)", () => {
    renderWithIntl(<ContextTab skillId="sk1" />);
    expect(mockUseSkillContextDocs).toHaveBeenCalledWith("sk1");
    expect(screen.getByText("specs/a.md")).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();
  });

  it("detaching the only attached doc calls useSetSkillContextDocs with []", () => {
    renderWithIntl(<ContextTab skillId="sk1" />);
    fireEvent.click(screen.getByLabelText("Detach"));
    expect(setMutate).toHaveBeenCalledWith([]);
  });

  it('renders the "SERIALIZES AS" preview reflecting the attached docs (AC-10)', () => {
    // `<pre>`'s textContent keeps its literal "\n" — `getByText`'s default
    // whitespace normalizer would collapse it to a space in the DOM text but
    // NOT in a literal-string matcher (client INSIGHTS.md 2026-07-28), so
    // this reads `container`/`textContent` directly instead of `getByText`.
    const { container } = renderWithIntl(<ContextTab skillId="sk1" />);
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    expect(container.querySelector("pre")!.textContent).toBe("## Project specifications\n- specs/a.md");
  });

  it('shows the empty "SERIALIZES AS" state when no docs are attached', () => {
    mockUseSkillContextDocs.mockReturnValue({ data: [] });
    const { container } = renderWithIntl(<ContextTab skillId="sk1" />);
    expect(container.querySelector("pre")!.textContent).toBe("## Project specifications\n(none attached)");
  });
});
