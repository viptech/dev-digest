# Severity badge tooltips (Run History + PR list)

## Context

Severity count badges (critical/warning/suggestion) already appear in three
places in the client UI:

1. **Findings panel** (`FindingsPanel.tsx`) — chips are clickable and drive a
   multi-select filter (`activeSeverities` state) over the findings list.
2. **Run History / PR timeline** (`RunHistory.tsx`) — per-run severity badges,
   currently inert `<span>`s with a dotted underline (decoration only, no
   `onClick`).
3. **Pull Requests list, FINDINGS column** — does not exist in code yet. A
   dead, unused type (`PrRowView.findings` in `client/src/lib/types.ts:38-48`)
   suggests it was planned but never wired up.

## Goal

Keep click-to-filter only in the Findings panel (unchanged). In the other two
locations, badges become hoverable: hovering a severity badge shows a tooltip
card listing the individual findings of that severity, with title, `file:line`,
confidence, and a short description — matching the reference screenshots.

## Non-goals

- No change to Findings panel behavior or its filter logic.
- No keyboard/focus-triggered tooltip variant (mouse hover only, no a11y
  affordance beyond native title-attribute fallback semantics) — acceptable
  since this is supplementary information, not primary navigation.
- No new dependency (no Radix Tooltip).

## Design

### Shared Tooltip component

A new lightweight component at `client/src/components/ui/Tooltip.tsx`:

- Controlled by `onMouseEnter` / `onMouseLeave` on a wrapper element; renders
  its content in an absolutely positioned card anchored to the wrapper
  (`position: absolute`, positioned via the wrapper's bounding rect — a portal
  is used only if the anchor's containing block clips overflow, discovered
  during implementation).
- Content is a card: for each finding — severity icon, title, `file:line`
  (link-styled, matching existing findings-panel link style), confidence
  percentage, one-line description.
- Takes `findings: Finding[]` as a prop and renders the same markup regardless
  of caller, so both integration points share one implementation.
- Shows nothing (no empty tooltip) when `findings` is empty for that severity.

### Run History integration

`RunHistory.tsx:203-242` already computes `findingsByRunId` mapping
`run_id → FindingRecord[]` in memory (full finding objects, not just counts).
Wrap the existing per-severity `<span>` badge in `Tooltip`, passing the subset
of that run's findings matching the badge's severity. No new data fetching.

### PR list integration

The FINDINGS column and its data do not exist yet:

1. **Contract**: extend `PrMeta` (`server/src/vendor/shared/contracts/platform.ts`)
   with a `findings_summary` field: per-severity counts plus the finding
   items needed for the tooltip (title, file, line, confidence, category,
   description), sourced from the PR's latest review run — the same read the
   list endpoint already does for `score`, so no additional query per PR.
2. **Client**: add a `findings` column to `COLUMN_KEYS` and the `GRID`
   template in `client/src/app/repos/[repoId]/pulls/_components/PRRow`'s
   `constants.ts`; render severity badges + `Tooltip` in `PRRow.tsx`. Adjust
   (rather than newly invent) the existing unused `PrRowView.findings` type in
   `client/src/lib/types.ts:38-48` to match the actual contract shape decided
   in step 1.
3. Wire the new field through the pulls-list route handler and any
   server-side mapping from DB findings records to the wire contract
   (`snake_case`, per repo convention).

### Findings panel

No changes.

## Testing

- Component test for `Tooltip`: shows on hover, hides on mouse leave, renders
  nothing for an empty findings array.
- `RunHistory`: existing badge rendering tests extended to assert tooltip
  content matches the run's findings for that severity.
- `PRRow`: new test asserting the FINDINGS column renders counts and tooltip
  content from `findings_summary`.
- Server: route/contract test asserting `findings_summary` is present and
  correctly aggregated per severity for the pulls-list endpoint.
