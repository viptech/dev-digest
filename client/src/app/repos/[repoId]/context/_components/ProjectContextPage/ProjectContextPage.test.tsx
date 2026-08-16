import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/projectContext.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));

let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => repoNotFound,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo-not-found</div>,
}));

const refetch = vi.fn();
type DocFixture = {
  path: string;
  category: string;
  chars: number;
  used_by_agents: number;
  used_by_skills: number;
};
let docs: DocFixture[] = [
  { path: "specs/public-api.md", category: "specs", chars: 40, used_by_agents: 3, used_by_skills: 0 },
  { path: "docs/architecture.md", category: "docs", chars: 20, used_by_agents: 0, used_by_skills: 0 },
];
vi.mock("@/lib/hooks/project-context", () => ({
  useRepoContextDocs: () => ({ data: docs, isLoading: false, isError: false, refetch }),
  useContextDocContent: () => ({ data: { content: "# Public API\ncontract text" }, isLoading: false }),
}));

import { ProjectContextPage } from "./ProjectContextPage";

afterEach(() => {
  cleanup();
  repoNotFound = false;
  docs = [
    { path: "specs/public-api.md", category: "specs", chars: 40, used_by_agents: 3, used_by_skills: 0 },
    { path: "docs/architecture.md", category: "docs", chars: 20, used_by_agents: 0, used_by_skills: 0 },
  ];
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextPage", () => {
  it("lists every discovered document with its category (AC-1, AC-2)", () => {
    renderWithIntl(<ProjectContextPage />);
    // specs/public-api.md is also selected by default (detail header) — 2 matches.
    expect(screen.getAllByText("specs/public-api.md").length).toBeGreaterThan(0);
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
  });

  it("lists a discovered .md file outside specs/docs/insights with category 'other' (e.g. a root-level README.md)", () => {
    docs = [...docs, { path: "README.md", category: "other", chars: 12, used_by_agents: 0, used_by_skills: 0 }];
    renderWithIntl(<ProjectContextPage />);
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("selects the first document by default and shows its content + used-by count", () => {
    renderWithIntl(<ProjectContextPage />);
    expect(screen.getByRole("heading", { name: "Public API" })).toBeInTheDocument();
    expect(screen.getByText("contract text")).toBeInTheDocument();
    expect(screen.getByText("used by 3 agents")).toBeInTheDocument();
  });

  it("also shows the skill-attachment count alongside the agent count — a doc attached only to a skill must not look unused (bug fix)", () => {
    docs = [
      { path: "specs/public-api.md", category: "specs", chars: 40, used_by_agents: 3, used_by_skills: 0 },
      { path: "docs/architecture.md", category: "docs", chars: 20, used_by_agents: 0, used_by_skills: 0 },
      { path: "client/INSIGHTS.md", category: "insights", chars: 30, used_by_agents: 0, used_by_skills: 1 },
    ];
    renderWithIntl(<ProjectContextPage />);
    fireEvent.click(screen.getByText("client/INSIGHTS.md"));
    expect(screen.getByText("used by 0 agents")).toBeInTheDocument();
    expect(screen.getByText("1 skill")).toBeInTheDocument();
  });

  it("hides the skill-attachment count entirely when it's zero — no '0 skills' clutter", () => {
    renderWithIntl(<ProjectContextPage />);
    expect(screen.queryByText(/skill/)).not.toBeInTheDocument();
  });

  it("clicking a row selects it", () => {
    renderWithIntl(<ProjectContextPage />);
    fireEvent.click(screen.getByText("docs/architecture.md"));
    expect(screen.getByText("used by 0 agents")).toBeInTheDocument();
  });

  it("clicking Refresh re-fetches discovery", () => {
    renderWithIntl(<ProjectContextPage />);
    fireEvent.click(screen.getByText("Refresh"));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows an empty state, not an error, when nothing is discovered (AC-3)", () => {
    docs = [];
    renderWithIntl(<ProjectContextPage />);
    expect(screen.getByText("No documents discovered")).toBeInTheDocument();
  });

  it("shows RepoNotFound for an invalid repoId instead of the page body", () => {
    repoNotFound = true;
    renderWithIntl(<ProjectContextPage />);
    expect(screen.getByText("repo-not-found")).toBeInTheDocument();
  });
});
