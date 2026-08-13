import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingResponse } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

// AppShell pulls in repo-context/theme/pulls hooks unrelated to this view;
// stub it to a passthrough so the test only exercises the page itself.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo-not-found</div>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));

let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/demo", default_branch: "main" } }),
  useRepoNotFound: () => repoNotFound,
}));

let onboardingData: OnboardingResponse | null = null;
let onboardingLoading = false;
let onboardingIsError = false;
let generatePending = false;
const generateMutate = vi.fn();
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: () => ({
    data: onboardingData,
    isLoading: onboardingLoading,
    isError: onboardingIsError,
    refetch: vi.fn(),
  }),
  useGenerateOnboarding: () => ({ mutate: generateMutate, isPending: generatePending }),
}));

import { OnboardingTourPage } from "./OnboardingTourPage";

const POPULATED_RESPONSE: OnboardingResponse = {
  generated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  sections: [
    {
      kind: "architecture",
      title: "How it's built",
      body: "# Overview\n\nA thing with <script>alert(1)</script> embedded in it.",
      diagram: null,
      links: [],
    },
    {
      kind: "critical_paths",
      title: "Files that matter most",
      body: "",
      diagram: null,
      links: [{ label: "Handles user auth", path: "src/auth/login.ts" }],
    },
    {
      kind: "local_setup",
      title: "Get it running",
      body: "",
      diagram: null,
      links: [],
      commands: [
        { cmd: "pnpm install", comment: "Install deps" },
        { cmd: "pnpm dev" },
      ],
    },
    {
      kind: "reading_order",
      title: "Where to start reading",
      body: "",
      diagram: null,
      links: [{ label: "Entry point for the API", path: "src/index.ts" }],
    },
    {
      kind: "first_tasks",
      title: "Good first tasks",
      body: "",
      diagram: null,
      links: [],
      tasks: [
        { title: "Fix flaky test", path: "src/test/foo.test.ts", complexity: "low" },
        // Ungrounded — server's grounding gate blanked this path (AC-6).
        { title: "Improve caching", path: "", complexity: "medium" },
        { title: "Add rate limit", path: "src/rate-limit.ts", complexity: "high" },
      ],
    },
  ],
};

const DEGRADED_RESPONSE: OnboardingResponse = {
  generated_at: new Date().toISOString(),
  degraded: true,
  degraded_reason: "index_partial",
  sections: POPULATED_RESPONSE.sections.map((sec) => ({ ...sec, diagram: null })),
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const clipboardWriteText = vi.fn();
beforeEach(() => {
  clipboardWriteText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  repoNotFound = false;
  onboardingData = null;
  onboardingLoading = false;
  onboardingIsError = false;
  generatePending = false;
  generateMutate.mockReset();
});

describe("OnboardingTourPage", () => {
  it("shows the 30–60s / ~5,000 tokens copy in the empty state", () => {
    renderWithIntl(<OnboardingTourPage />);
    // `generate.title` and `generate.cta` happen to be the identical string
    // ("Generate onboarding tour") — asserted via getAllByText(length 2)
    // rather than getByText, which would throw on the intentional duplicate
    // (client/INSIGHTS.md 2026-07-31 gotcha).
    expect(screen.getAllByText(messages.generate.title)).toHaveLength(2);
    expect(screen.getByText(/30.60s/)).toBeInTheDocument();
    expect(screen.getByText(/~5,000 tokens/)).toBeInTheDocument();
  });

  it("shows the degraded banner and still renders all 5 sections from a degraded generate() result", () => {
    generateMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (d: OnboardingResponse) => void }) => {
      opts?.onSuccess?.(DEGRADED_RESPONSE);
    });
    renderWithIntl(<OnboardingTourPage />);
    // `generate.cta` and `generate.title` are the identical string — scope to
    // the actual `<button>` role so this doesn't collide with the title div.
    fireEvent.click(screen.getByRole("button", { name: messages.generate.cta }));

    expect(screen.getByText(messages.degraded.banner.index_partial)).toBeInTheDocument();
    const cardIds = [
      "onboarding-section-architecture",
      "onboarding-section-critical_paths",
      "onboarding-section-local_setup",
      "onboarding-section-reading_order",
      "onboarding-section-first_tasks",
    ];
    for (const id of cardIds) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('"ON THIS PAGE" click scrolls and focuses the matching section', () => {
    onboardingData = POPULATED_RESPONSE;
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderWithIntl(<OnboardingTourPage />);

    const nav = screen.getByRole("navigation", { name: messages.onThisPage });
    fireEvent.click(within(nav).getByRole("button", { name: messages.kinds.critical_paths }));

    expect(scrollSpy).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("onboarding-section-critical_paths");
  });

  it("each card collapses/expands independently", () => {
    onboardingData = POPULATED_RESPONSE;
    renderWithIntl(<OnboardingTourPage />);

    // Both cards start open.
    expect(screen.getByText("pnpm install")).toBeInTheDocument();
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();

    // Collapse only the "Get it running" (local_setup) card.
    fireEvent.click(screen.getByText("Get it running"));
    expect(screen.queryByText("pnpm install")).not.toBeInTheDocument();
    // The other card is untouched.
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();
  });

  it('"Share link" copies the full absolute URL to the clipboard', () => {
    onboardingData = POPULATED_RESPONSE;
    window.history.pushState({}, "", "/repos/r1/onboarding");
    renderWithIntl(<OnboardingTourPage />);

    fireEvent.click(screen.getByText(messages.shareLink));

    expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedUrl = clipboardWriteText.mock.calls[0]?.[0] as string;
    expect(copiedUrl.endsWith("/repos/r1/onboarding")).toBe(true);
  });

  it("renders each kind's distinguishing layout", () => {
    onboardingData = POPULATED_RESPONSE;
    renderWithIntl(<OnboardingTourPage />);

    // architecture — Markdown body with a real heading element.
    expect(screen.getByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    // critical_paths — grounded path gets an "Open" link (scoped: reading_order
    // also renders its own "Open" link for its own grounded path, so an
    // unscoped `getByText` here would find two matches).
    const criticalPathsBody = document.getElementById("onboarding-section-critical_paths")!;
    expect(within(criticalPathsBody).getByText(messages.openOnGithub)).toBeInTheDocument();
    // local_setup — one copy button per command.
    expect(screen.getAllByLabelText(messages.copyCommand)).toHaveLength(2);
    // reading_order — numbered rationale text.
    expect(screen.getByText("Entry point for the API")).toBeInTheDocument();
    // first_tasks — 3-card grid with complexity badges.
    expect(screen.getByText("low")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders an ungrounded task's title with no Open/path link", () => {
    onboardingData = POPULATED_RESPONSE;
    renderWithIntl(<OnboardingTourPage />);

    const firstTasksBody = document.getElementById("onboarding-section-first_tasks")!;
    expect(within(firstTasksBody).getByText("Improve caching")).toBeInTheDocument();
    // Only the two grounded tasks (path !== '') get a link.
    expect(within(firstTasksBody).getAllByRole("link")).toHaveLength(2);
  });

  it("renders a literal <script> in the body as visible, inert text — never executes", () => {
    onboardingData = POPULATED_RESPONSE;
    const { container } = renderWithIntl(<OnboardingTourPage />);

    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
