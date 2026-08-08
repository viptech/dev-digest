import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { BlastRadius } from "@devdigest/shared";

let mockBlast: BlastRadius | undefined;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({ data: mockBlast, isLoading: mockIsLoading, isError: mockIsError }),
}));

import { BlastTab } from "./BlastTab";

afterEach(() => {
  cleanup();
  mockBlast = undefined;
  mockIsLoading = false;
  mockIsError = false;
});

function blastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [{ file: "src/helper.ts", name: "sharedHelper", kind: "function" }],
    downstream: [
      {
        symbol: "sharedHelper",
        callers: [
          { name: "handleRequest", file: "src/route.ts", line: 42 },
          { name: "processJob", file: "src/worker.ts", line: 7 },
        ],
        endpoints_affected: ["GET /widgets"],
        crons_affected: [],
      },
    ],
    summary: "1 symbol(s) changed, 2 caller(s), 1 endpoint(s) potentially affected",
    ...overrides,
  };
}

describe("BlastTab", () => {
  it("renders the symbol group expanded by default, with its callers and endpoints visible", () => {
    mockBlast = blastRadius();
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);

    expect(screen.getByText(/sharedHelper/)).toBeInTheDocument();
    expect(screen.getByText("Callers (2)")).toBeInTheDocument();
    expect(screen.getByText("src/route.ts:42")).toBeInTheDocument();
    expect(screen.getByText("GET /widgets")).toBeInTheDocument();
  });

  it("collapsing the symbol group hides its callers/endpoints", () => {
    mockBlast = blastRadius();
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);

    fireEvent.click(screen.getByRole("button", { name: /sharedHelper/i }));
    expect(screen.queryByText("src/route.ts:42")).not.toBeInTheDocument();
  });

  it("a rendered caller MonoLink's href is githubBlobUrl-shaped", () => {
    mockBlast = blastRadius();
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);

    const link = screen.getByText("src/route.ts:42").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/abc123/src/route.ts#L42",
    );
  });

  it("shows no degraded banner when blast.degraded is falsy", () => {
    mockBlast = blastRadius();
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);
    expect(screen.queryByText(/may be missing/)).not.toBeInTheDocument();
  });

  it("shows a reason-keyed degraded banner when blast.degraded is true", () => {
    mockBlast = blastRadius({ degraded: true, reason: "index_partial" });
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);
    expect(screen.getByText(/Index is partial — some callers\/endpoints may be missing/)).toBeInTheDocument();
  });

  it("never renders an empty tree silently — shows an explanatory message when downstream is empty", () => {
    mockBlast = blastRadius({ downstream: [] });
    render(<BlastTab prId="pr-1" repoFullName="acme/widgets" headSha="abc123" />);
    expect(screen.getByText(/No downstream callers found/)).toBeInTheDocument();
  });
});
