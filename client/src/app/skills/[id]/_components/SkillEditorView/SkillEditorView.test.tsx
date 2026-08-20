import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/skills.json";
import projectContextMessages from "../../../../../../messages/en/projectContext.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

// AppShell pulls in repo-context/theme/pulls hooks unrelated to this view;
// stub it to a passthrough so the test only exercises SkillEditorView itself.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const routerReplace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

const useSkillMock = vi.fn();
const useUpdateSkillMock = vi.fn();
const useSkillContextDocsMock = vi.fn();
const useSetSkillContextDocsMock = vi.fn();
const useSkillStatsMock = vi.fn();
const useSkillVersionsMock = vi.fn();

// Wiring all 6 tabs into the body (Step 10) pulls in every tab's own data
// hook — mock the whole `@/lib/hooks/skills` module here (not just `useSkill`
// as before Step 10) so Config/Context/Stats/Versions render without a real
// QueryClient/network (same shape as each tab's own *.test.tsx).
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: (id: string | null | undefined) => useSkillMock(id),
  useUpdateSkill: () => useUpdateSkillMock(),
  useSkillContextDocs: (...args: unknown[]) => useSkillContextDocsMock(...args),
  useSetSkillContextDocs: (...args: unknown[]) => useSetSkillContextDocsMock(...args),
  useSkillStats: (...args: unknown[]) => useSkillStatsMock(...args),
  useSkillVersions: (...args: unknown[]) => useSkillVersionsMock(...args),
}));

// The Evals tab (`@/components/eval-owner-tab`) reads its data through
// `@/lib/hooks/evals`, which itself calls react-query's useQuery/useMutation
// directly — mock it the same way `EvalOwnerTab.test.tsx` does so it renders
// without a QueryClientProvider.
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvalSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvalRunHistory: () => ({ data: [] }),
}));

// The Context tab's `ContextDocPicker` pulls in repo-context/project-context
// hooks unrelated to this view — stub it to a passthrough, same pattern as
// `AgentEditor.test.tsx`.
vi.mock("@/components/context-doc-picker", () => ({
  ContextDocPicker: () => <div>context-doc-picker</div>,
}));

import { SkillEditorView } from "./SkillEditorView";

const SKILL = {
  id: "s1",
  name: "PR Quality Rubric",
  description: "d",
  type: "rubric" as const,
  source: "manual" as const,
  body: "# Rule",
  enabled: true,
  version: 3,
};

afterEach(() => {
  cleanup();
  routerReplace.mockClear();
  searchParams = new URLSearchParams();
  useUpdateSkillMock.mockReset();
  useSkillContextDocsMock.mockReset();
  useSetSkillContextDocsMock.mockReset();
  useSkillStatsMock.mockReset();
  useSkillVersionsMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ skills: messages, projectContext: projectContextMessages, eval: evalMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

// Every tab needs *some* default so the tests that don't specifically target
// a given tab (e.g. the header/tab-bar smoke tests, which render the default
// "config" tab body too now that Step 10 wires it in) don't crash on an
// un-mocked hook return.
function mockAllTabHooksWithDefaults() {
  useUpdateSkillMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined });
  useSkillContextDocsMock.mockReturnValue({ data: [] });
  useSetSkillContextDocsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useSkillStatsMock.mockReturnValue({
    data: {
      skill_id: "s1",
      skill_name: "PR Quality Rubric",
      used_by_agents: 0,
      pull_rate: null,
      accept_rate: null,
      agents: [],
      cost_by_category: [],
    },
    isLoading: false,
  });
  useSkillVersionsMock.mockReturnValue({ data: [], isLoading: false });
}

describe("SkillEditorView", () => {
  it("renders all 6 tabs", () => {
    useSkillMock.mockReturnValue({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() });
    mockAllTabHooksWithDefaults();
    renderWithIntl(<SkillEditorView id="s1" />);
    for (const label of ["Config", "Context", "Preview", "Evals", "Stats", "Versions"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("an invalid ?tab= falls back to config (the AgentEditorPage.tsx:16-21 regression)", () => {
    searchParams = new URLSearchParams("tab=bogus");
    useSkillMock.mockReturnValue({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() });
    mockAllTabHooksWithDefaults();
    renderWithIntl(<SkillEditorView id="s1" />);
    const configButton = screen.getByText("Config").closest("button")!;
    const contextButton = screen.getByText("Context").closest("button")!;
    expect(configButton.getAttribute("style")).toContain("var(--accent)");
    expect(contextButton.getAttribute("style")).toContain("transparent");
    expect(contextButton.getAttribute("style")).not.toContain("var(--accent)");
  });

  it("shows the skill's name and version badge in the header", () => {
    useSkillMock.mockReturnValue({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() });
    mockAllTabHooksWithDefaults();
    renderWithIntl(<SkillEditorView id="s1" />);
    expect(screen.getByText("PR Quality Rubric")).toBeInTheDocument();
    // Scoped to the header container, not the whole document: the default
    // "config" tab body (wired in Step 10) renders `ConfigTab`, which shows
    // its OWN "v{version}" badge too — an unscoped `getByText("v3")` matches
    // both and throws "multiple elements found" (the same duplicate-getByText
    // class documented 8x in client/INSIGHTS.md). The header is the nearest
    // ancestor <div> of the <h1> — `s.header` in styles.ts.
    const header = screen.getByText("PR Quality Rubric").closest("div")!;
    expect(within(header).getByText("v3")).toBeInTheDocument();
  });

  it("a 404 from useSkill(id) shows ErrorState, not an empty/broken render (AC-3)", () => {
    useSkillMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("No skill with that id in this workspace", 404),
      refetch: vi.fn(),
    });
    renderWithIntl(<SkillEditorView id="unknown" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
    expect(screen.getByText("No skill with that id in this workspace")).toBeInTheDocument();
    expect(screen.queryByText("Config")).not.toBeInTheDocument();
  });

  it("switching between all 6 tabs renders each one's expected content", () => {
    useSkillMock.mockReturnValue({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() });
    useUpdateSkillMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined });
    useSkillContextDocsMock.mockReturnValue({ data: [] });
    useSetSkillContextDocsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useSkillStatsMock.mockReturnValue({
      // Deliberately distinct from every other fixture number in this test
      // and from the header's "v3" badge (client INSIGHTS.md duplicate-
      // `getByText` gotcha class) — 5 agents here can't collide with
      // anything else asserted below.
      data: {
        skill_id: "s1",
        skill_name: "PR Quality Rubric",
        used_by_agents: 5,
        pull_rate: 0.4,
        accept_rate: 0.7,
        agents: [],
        cost_by_category: [],
      },
      isLoading: false,
    });
    useSkillVersionsMock.mockReturnValue({
      data: [
        { skill_id: "s1", version: 2, body: "# Rule v2", created_at: "2026-08-10T00:00:00.000Z" },
        { skill_id: "s1", version: 1, body: "# Rule v1", created_at: "2026-08-01T00:00:00.000Z" },
      ],
      isLoading: false,
    });

    const { rerender } = renderWithIntl(<SkillEditorView id="s1" />);
    const withIntl = (ui: React.ReactElement) => (
      <NextIntlClientProvider
        locale="en"
        messages={{ skills: messages, projectContext: projectContextMessages, eval: evalMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    );

    // config (default) — the editable name field, unique to `getByDisplayValue`
    // (distinct from the header's `<h1>` text node, which `getByText` reads).
    expect(screen.getByDisplayValue("PR Quality Rubric")).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=context");
    rerender(withIntl(<SkillEditorView id="s1" />));
    expect(screen.getByText("context-doc-picker")).toBeInTheDocument();
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=preview");
    rerender(withIntl(<SkillEditorView id="s1" />));
    expect(screen.getByRole("heading", { name: "Rule" })).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=evals");
    rerender(withIntl(<SkillEditorView id="s1" />));
    expect(screen.getByText("Eval cases")).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=stats");
    rerender(withIntl(<SkillEditorView id="s1" />));
    expect(screen.getByText("5 agents")).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=versions");
    rerender(withIntl(<SkillEditorView id="s1" />));
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });
});
