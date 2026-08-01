import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindingsTooltip, type TooltipFinding } from "./FindingsTooltip";

afterEach(cleanup);

function finding(overrides: Partial<TooltipFinding> = {}): TooltipFinding {
  return {
    id: "f1",
    severity: "WARNING",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    confidence: 0.86,
    rationale: "The loop calls db.posts.findMany once per user.",
    ...overrides,
  };
}

describe("FindingsTooltip", () => {
  it("always renders its children", () => {
    render(
      <FindingsTooltip findings={[finding()]}>
        <span>2</span>
      </FindingsTooltip>,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows no card content before hover", () => {
    render(
      <FindingsTooltip findings={[finding()]}>
        <span>2</span>
      </FindingsTooltip>,
    );
    expect(screen.queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
  });

  it("shows each finding's title and file:line on hover, hides again on mouse leave", () => {
    render(
      <FindingsTooltip
        findings={[
          finding({ id: "f1", title: "N+1 query in user list endpoint" }),
          finding({
            id: "f2",
            title: "Extract magic number 3600",
            file: "src/middleware/ratelimit.ts",
            start_line: 28,
            end_line: 28,
            rationale: "The number 3600 appears twice without explanation.",
          }),
        ]}
      >
        <span>2</span>
      </FindingsTooltip>,
    );
    const anchor = screen.getByText("2").parentElement!;
    fireEvent.mouseEnter(anchor);
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:28")).toBeInTheDocument();
    expect(screen.getByText("The loop calls db.posts.findMany once per user.")).toBeInTheDocument();

    fireEvent.mouseLeave(anchor);
    expect(screen.queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
  });

  it("renders only children, no hover affordance, when findings is empty", () => {
    render(
      <FindingsTooltip findings={[]}>
        <span>0</span>
      </FindingsTooltip>,
    );
    const anchor = screen.getByText("0").parentElement!;
    fireEvent.mouseEnter(anchor);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
