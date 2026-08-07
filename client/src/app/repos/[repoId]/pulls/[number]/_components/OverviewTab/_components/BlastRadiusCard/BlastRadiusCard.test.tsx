import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { BlastRadius } from "@devdigest/shared";

let mockBlast: BlastRadius | undefined;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({ data: mockBlast, isLoading: mockIsLoading, isError: mockIsError }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  mockBlast = undefined;
  mockIsLoading = false;
  mockIsError = false;
});

function blastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [
      { file: "src/api/public/rate-limit.ts", name: "rateLimit", kind: "function" },
      { file: "src/api/public/bucket.ts", name: "bucketKey", kind: "function" },
    ],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [
          { name: "handler", file: "src/api/public/index.ts", line: 23 },
          { name: "webhookHandler", file: "src/api/public/webhooks.ts", line: 45 },
        ],
        endpoints_affected: ["GET /api/public/items", "POST /api/public/webhooks"],
        crons_affected: ["reset-rate-buckets (hourly)"],
      },
      {
        symbol: "bucketKey",
        callers: [{ name: "rateLimit", file: "src/api/public/rate-limit.ts", line: 10 }],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
    summary: "2 symbol(s) changed, 3 caller(s), 2 endpoint(s) potentially affected",
    ...overrides,
  };
}

describe("BlastRadiusCard", () => {
  it("renders header counts (symbols/callers/endpoints/crons) from the blast data", () => {
    mockBlast = blastRadius();
    render(<BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />);

    expect(screen.getByText(/2 symbols/)).toBeInTheDocument();
    expect(screen.getByText(/3 callers/)).toBeInTheDocument();
    expect(screen.getByText(/2 endpoints/)).toBeInTheDocument();
    expect(screen.getByText(/1 cron\b/)).toBeInTheDocument();
  });

  it("expands the first symbol group by default, with its callers and endpoint/cron chips inline (no subheaders)", () => {
    mockBlast = blastRadius();
    render(<BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />);

    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
    expect(screen.queryByText(/^Callers \(/)).not.toBeInTheDocument();
  });

  it("keeps the second symbol group collapsed by default", () => {
    mockBlast = blastRadius();
    render(<BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />);
    expect(screen.queryByText("src/api/public/rate-limit.ts:10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /bucketKey/i }));
    expect(screen.getByText("src/api/public/rate-limit.ts:10")).toBeInTheDocument();
  });

  it("a caller link is githubBlobUrl-shaped", () => {
    mockBlast = blastRadius();
    render(<BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />);

    const link = screen.getByText("src/api/public/index.ts:23").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23",
    );
  });

  it("shows a degraded banner when blast.degraded is true", () => {
    mockBlast = blastRadius({ degraded: true, reason: "index_partial" });
    render(<BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />);
    expect(screen.getByText(/Index is partial/)).toBeInTheDocument();
  });

  it("renders nothing while loading or on error, instead of an empty card", () => {
    mockIsLoading = true;
    const { container } = render(
      <BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
