import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("highlights Onboarding Tour only for the repo-scoped tour route", () => {
    expect(activeKeyFor("/repos/repo1/onboarding")).toBe("onboarding-tour");
    expect(activeKeyFor("/repos/repo1/onboarding/")).toBe("onboarding-tour");
  });

  it("does NOT highlight Onboarding Tour for the unrelated add-repository wizard route", () => {
    // `/onboarding` (no :repoId) is the already-shipped connect-a-repo wizard
    // — a plain `.includes("/onboarding")` used to over-match this route too.
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("still resolves the other repo-scoped keys unaffected by the fix", () => {
    expect(activeKeyFor("/repos/repo1/context")).toBe("context");
    expect(activeKeyFor("/repos/repo1/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/repo1/pulls")).toBe("pulls");
  });
});
