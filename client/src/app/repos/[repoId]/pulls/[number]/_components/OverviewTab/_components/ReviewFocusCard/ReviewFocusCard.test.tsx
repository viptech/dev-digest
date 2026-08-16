import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { ReviewFocusItem } from "@devdigest/shared";

import { ReviewFocusCard } from "./ReviewFocusCard";

afterEach(cleanup);

const ITEMS: ReviewFocusItem[] = [
  { path: "src/config.ts", line: 12, note: "live Stripe key committed in plaintext" },
  { path: "src/api/users.ts", line: null, note: "N+1 query under the new limiter" },
];

describe("ReviewFocusCard", () => {
  it("renders nothing when review_focus is empty or absent", () => {
    const { container: empty } = render(<ReviewFocusCard reviewFocus={[]} />);
    expect(empty).toBeEmptyDOMElement();
    cleanup();
    const { container: absent } = render(<ReviewFocusCard />);
    expect(absent).toBeEmptyDOMElement();
  });

  it("renders the count badge and each formatted row", () => {
    render(<ReviewFocusCard reviewFocus={ITEMS} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText(/live Stripe key committed in plaintext/)).toBeInTheDocument();
    // No line → path only, no trailing colon.
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("clicking a row calls onOpenFile(path, line)", () => {
    const onOpenFile = vi.fn();
    render(<ReviewFocusCard reviewFocus={ITEMS} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("src/config.ts:12"));
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 12);
  });

  it("clicking a line-less row calls onOpenFile(path, null)", () => {
    const onOpenFile = vi.fn();
    render(<ReviewFocusCard reviewFocus={ITEMS} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("src/api/users.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("src/api/users.ts", null);
  });
});
