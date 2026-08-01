import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function pr(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: 61,
    cost_usd: 0.014,
    findings_summary: null,
    ...overrides,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings column", () => {
  it("renders zeroed severity badges when the PR has never been reviewed", () => {
    renderRow(pr({ findings_summary: null }));
    expect(screen.getAllByText("0")).toHaveLength(3);
  });

  it("renders the latest review's severity counts and a hover tooltip per severity", () => {
    renderRow(
      pr({
        findings_summary: {
          counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 1 },
          items: [
            {
              id: "f1",
              severity: "WARNING",
              category: "perf",
              title: "N+1 query in user list endpoint",
              file: "src/api/users.ts",
              start_line: 45,
              end_line: 52,
              confidence: 0.86,
              rationale: "The loop calls db.posts.findMany once per user.",
            },
            {
              id: "f2",
              severity: "SUGGESTION",
              category: "style",
              title: "Extract magic number 3600",
              file: "src/middleware/ratelimit.ts",
              start_line: 28,
              end_line: 28,
              confidence: 0.62,
              rationale: "The number 3600 appears twice without explanation.",
            },
          ],
        },
      }),
    );
    expect(screen.getByTestId("pr-findings-badge-CRITICAL")).toHaveTextContent("0");
    expect(screen.getByTestId("pr-findings-badge-WARNING")).toHaveTextContent("1");
    expect(screen.getByTestId("pr-findings-badge-SUGGESTION")).toHaveTextContent("1");

    fireEvent.mouseEnter(screen.getByTestId("pr-findings-badge-WARNING"));
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
  });
});
