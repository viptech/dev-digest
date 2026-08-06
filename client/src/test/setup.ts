import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement scrollIntoView — several components (CodeLine,
// ReviewRunAccordion, FindingCard) call it on their own ref to jump the user
// to a highlighted line/card.
if (typeof globalThis.Element !== "undefined" && !globalThis.Element.prototype.scrollIntoView) {
  globalThis.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
