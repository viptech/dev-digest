# Development Plan — Align `EvalsTab` with the course reference mockup

**Execution mode:** multi-agent

## Context

`EvalsTab.tsx` (`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`,
SPEC-05) currently renders eval cases as a flat list (name + pass/fail badge +
Run/Delete buttons) with Run all / History / Compare sections below. The user
supplied a screenshot of the course reference mockup — the same one already
cited in `docs/specs/SPEC-05-eval-pipeline.md` and in `client/INSIGHTS.md`'s
2026-08-19 `METRIC_COLOR` entry — and the current page does not match it. This
plan adds: (1) a 4-card eval-metrics header block above the case list, and (2)
richer per-case rows (status icon, MUST FIND/MUST NOT FLAG badge, "expected
N, got M" subtitle, severity-category tag), while leaving the existing Run
all / History / Compare sections functionally untouched — only moved below
the new blocks.

## Modules involved

- **client** (primary) — `EvalsTab.tsx`/`helpers.ts`/`styles.ts`/`.test.tsx`,
  a new shared constant module (`client/src/lib/eval-metrics.ts`), a small
  edit to `client/src/lib/hooks/evals.ts` (route-level DTO type), and new
  translation keys in `client/messages/en/eval.json`.
- **server** (small, additive) — `server/src/modules/evals/service.ts`: add
  `actual_count` to the `last_run` summary `list()` already returns. No new
  route, no new zod contract.
- **shared contracts** — NOT touched. `actual_count` stays a route-level DTO
  field (same treatment as the rest of `EvalCaseWithLastRun`), not a
  `server/src/vendor/shared/contracts/` schema.
- `reviewer-core` / `e2e` — not involved.

## Constraints

- **Dual-copy DTO convention**: `EvalCaseWithLastRun` is intentionally
  duplicated, not shared — once server-side in
  `server/src/modules/evals/service.ts:32-34`, once client-side in
  `client/src/lib/hooks/evals.ts:10-12` — "to avoid the dual-copy
  client/server contract drift this feature has hit before" (comment at both
  sites; pattern documented root `INSIGHTS.md` 2026-07-31). Adding
  `actual_count` means editing **both**, by hand, kept in sync.
- **`GET /agents/:id/evals` has no zod response schema**
  (`server/src/modules/evals/routes.ts:39-42`, `schema: { params: IdParams }`
  only) — confirmed by reading the route: adding `actual_count` to the
  service's return value needs no schema/contract change.
- **`EvalExpectation` contract** (`server/src/vendor/shared/contracts/knowledge.ts:29-37`):
  `{ type: 'must_find'|'must_not_flag', file, start_line?, end_line?,
  severity?, category? }` — no `title` field (confirmed; `title` in
  `eval-case-modal/helpers.ts`'s `SKELETON_EXPECTATION` is a client-only
  authoring hint, stripped server-side). `severity` is `Severity`
  (`CRITICAL`/`WARNING`/…, uppercase labels via `SEV` in
  `client/src/vendor/ui/primitives/tokens.ts:6-14`), `category` is
  `FindingCategory` (`bug|security|perf|style|test`, lowercase labels via
  `CAT`, same file:16-22) — exactly the pieces needed for the mockup's
  "CRITICAL - security" tag.
- **`METRIC_COLOR` is the ONLY sanctioned color mapping** for
  recall/precision/citation_accuracy — `client/src/app/eval-dashboard/_components/EvalDashboardView/styles.ts:9-13`.
  `client/INSIGHTS.md` (2026-08-19 decision) states explicitly: "If these
  metrics appear in `EvalsTab`/`EvalCaseModal` later — reuse this same
  palette, not a new one." Do not invent a second palette.
- **Cross-feature import smell → promote, don't reach across** —
  `client/INSIGHTS.md` (2026-08-19 decision, "promote on the second user"):
  `EvalCaseModal` was already promoted out of `EvalsTab/_components/` into
  `client/src/components/eval-case-modal/` specifically because a second
  caller in another feature tree (`FindingsPanel`) needed it — "a relative
  import climbs out of one feature and into another" is the trigger, not
  something to route around with a long `../../../../../..` chain. The same
  rule applies to `METRIC_COLOR`: it currently lives inside
  `eval-dashboard/_components/EvalDashboardView/styles.ts` (one feature's
  `_components/`), and `EvalsTab` (a different feature tree,
  `agents/[id]/_components/...`) becoming its second consumer is exactly that
  trigger — see Ordered Steps, "Promote `METRIC_COLOR`" below.
- **`Badge` renders all `children` in ONE `<span>`** — multiple JSX
  interpolations inside one `<Badge>` collapse into a single text node and
  break exact-match `getByText` on any sub-part (`client/src/vendor/ui/primitives/Badge.tsx:24-48`;
  gotcha documented `client/INSIGHTS.md` 2026-08-19, hit previously in
  `EvalCaseModal.tsx`). The new "CRITICAL - security" tag must be built as
  ONE pre-joined string (e.g. a single template-literal interpolation), or
  rendered as a plain `<span>` outside `Badge` — not as `<Badge>{a} - {b}</Badge>`.
- **`@testing-library/user-event` is not installed** — continue using
  `fireEvent` in the updated test file, per `client/INSIGHTS.md` 2026-08-13.
- **Relative-import depth in this exact folder has been miscounted twice
  before** (`client/INSIGHTS.md` 2026-08-02, both `EvalsTab.tsx` and
  `StatsTab.tsx` entries) — if any new relative import is added (should not
  be needed; the plan routes new cross-feature reuse through `@/lib/...`
  aliases instead), verify depth with
  `node -e "console.log(path.relative(fromDir, toDir))"`, never by eyeballing
  a neighboring import.
- **`client/CLAUDE.md`**: feature-folder shape (`<Name>.tsx`, `index.ts`,
  `styles.ts`, `helpers.ts`, `<Name>.test.tsx` colocated under
  `_components/<Name>/`); data hooks live in `src/lib/hooks/*`, not inline
  `fetch`.
- **Root `CLAUDE.md` do-not-touch**: no migrations, no changes to the
  grounding gate or injection guard — none of this task's surfaces come near
  them; called out here only for completeness/confirmation, not because
  anything in this plan risks them.
- **Wire contracts are snake_case** — `actual_count` (not `actualCount`)
  matches the existing `last_run: { pass, recall, ran_at }` shape's
  convention.

## Open questions

Resolve these while implementing; do not block on them, but the choice made
should be a deliberate one-line comment at the call site, not a silent
default:

1. **Case row tag when `expected_output` has 0 or 2+ entries.** The mockup
   only ever shows exactly one severity-category tag (or one "assert empty")
   per row — every example case has exactly one expectation. Proposed
   default: for `must_find`, use the **first** `must_find` entry's
   severity/category (ignore the rest visually — the "expected N, got M"
   subtitle already communicates the real count); for `must_not_flag`-only
   sets (any length), render "assert empty"; for an empty `expected_output`
   array, render no tag at all (row still shows the MUST FIND/MUST NOT FLAG
   badge is also absent — decide what the badge itself shows when there's
   nothing to classify, e.g. omit both badge and tag).
2. **"expected N, got M" when the case has never been run** (`last_run ===
   null`).  There's no `actual_output` to count. Proposed default: render
   "expected N findings" without a "got M" clause (or a "not yet run"
   variant) rather than fabricating `got 0`.
3. **Metrics-card block when there is no set-run history yet**
   (`groups.length === 0`, i.e. `groupRuns(historyRows)` is empty). Proposed
   default: don't render the 4-card row at all in that state (the existing
   "No set-runs yet" empty state below already communicates this), rather
   than showing four cards full of zeros.
4. **Exact pixel/spacing fidelity to the screenshot** is not required —
   reuse existing design tokens (`var(--ok)`/`var(--crit)`/`var(--warn)`/
   `var(--accent)`, existing `card`/`row` style shapes from
   `EvalDashboardView/styles.ts` and `EvalsTab/styles.ts`) rather than
   hand-tuning new ad hoc values.
5. **Metric label copy**: `EvalDashboardView.tsx` hardcodes "RECALL"/"PREC"/
   "CITE" as literal English JSX text (not run through `t()`), even though
   this app otherwise localizes consistently via `next-intl`. The new cards
   should prefer proper `t()` keys (new `eval.json` copy is already part of
   this plan's file list) for consistency with the rest of `EvalsTab`, even
   though that diverges from the one precedent in `EvalDashboardView`. Not a
   blocker either way.

## Skills the implementer will use

- **`react-ui-architecture`** — directly governs two decisions in this plan:
  (a) promoting `METRIC_COLOR` out of `eval-dashboard/_components/` into a
  shared `client/src/lib/` module (second-caller-from-another-feature-tree
  rule, same rule that already promoted `EvalCaseModal`), and (b) keeping the
  new helper logic (`deriveCaseTag`, `casesPassingSummary`) inside
  `EvalsTab/helpers.ts` (feature-local) rather than promoting anything
  further, since `EvalsTab` remains the only caller.
- **`react-best-practices`** — component/hook structure for the new
  metrics-card block and enriched case rows (avoiding unnecessary re-renders,
  correct `useMemo` usage for derived metric/tag values already following the
  existing `groups`/`comparisonPair` pattern in the file).
- **`react-testing-library`** — updating `EvalsTab.test.tsx` for the new row
  markup (status icon, badge, tag, subtitle) and new metrics-card assertions;
  keep using `fireEvent` (no `user-event` dependency), watch for the
  `getByText` exact-match / multiple-nodes pitfalls already logged in
  `client/INSIGHTS.md` (2026-07-31, 2026-08-13, 2026-08-19 entries).
- **`onion-architecture`** — for the one-line server change
  (`EvalsService.list()`): the new `actual_count` derivation belongs in the
  service layer reading an already-fetched `EvalRunRow`, not in the route
  handler or a new adapter.
- **`typescript-expert`** — if the generalized `deriveCaseTag` needs a
  discriminated-union return type distinguishing "no tag" / "must_find tag" /
  "must_not_flag tag" cleanly (see Open Question 1).
- **`engineering-insights`** — invoke at the end per root `CLAUDE.md`'s
  session protocol if anything non-obvious turns up while implementing (e.g.
  an unexpected interaction between the promoted `METRIC_COLOR` module and
  existing imports, or a `getByText` collision in the new row markup).

## Ordered steps

### 1. Server — expose `actual_count` on `last_run`

- `server/src/modules/evals/service.ts`:
  - Extend the `EvalCaseWithLastRun` interface (`:32-34`) — `last_run` gains
    `actual_count: number`.
  - In `list()` (`:97-109`), where `run` (the full `EvalRunRow`, not just the
    summary) is already available, compute
    `Array.isArray(run.actualOutput) ? run.actualOutput.length : 0` and add
    it to the returned `last_run` object.
  - Resolve Open Question 2 for the `run == null` branch (no `last_run` at
    all — nothing to add there; the client side handles the "never run"
    case).

### 2. Client — mirror the DTO field

- `client/src/lib/hooks/evals.ts`: extend `EvalCaseWithLastRun.last_run`
  (`:10-12`) with the same `actual_count: number`, matching the server change
  by hand (dual-copy convention, no shared contract).

### 3. Promote `METRIC_COLOR` to a shared, non-feature-local module

- Create `client/src/lib/eval-metrics.ts` (following the existing
  `client/src/lib/findings.ts` precedent — small pure derivation/constant
  module, no React) exporting the `METRIC_COLOR` object currently defined in
  `client/src/app/eval-dashboard/_components/EvalDashboardView/styles.ts:9-13`,
  with its existing doc comment carried over (and updated to note it's now
  the shared location).
- Update `EvalDashboardView/styles.ts` to `export { METRIC_COLOR } from
  "@/lib/eval-metrics"` (or import + re-export) instead of defining it
  locally — keeps `EvalDashboardView.tsx`'s existing `import { s,
  METRIC_COLOR } from "./styles"` working unchanged, zero blast radius on
  that file.
- `EvalsTab/styles.ts` (or `EvalsTab.tsx` directly) imports `METRIC_COLOR`
  from `@/lib/eval-metrics`.

### 4. Client — `EvalsTab/helpers.ts` new derivations

Add alongside the existing `groupRuns`/`caseTransitions`:

- `deriveCaseTag(expected: EvalExpectation[]): CaseTag | null` — generalizes
  `eval-case-modal/helpers.ts`'s `deriveExpectationSummary` (which is
  intentionally scoped to build one full sentence for exactly one entry, for
  the modal's editor context — do NOT force-reuse it here, it's a different
  concern per the task brief's own suggestion). Handles 0/1/N entries per
  Open Question 1's resolution; returns enough to render both the MUST
  FIND/MUST NOT FLAG badge and the severity-category tag / "assert empty"
  text.
- `casesPassingSummary(cases: EvalCaseWithLastRun[]): { passing: number;
  total: number }` — counts `c.last_run?.pass === true` over `cases.length`,
  for the "6 / 8 passing" badge.
- A small helper (or inline in the component via `useMemo`, implementer's
  call) deriving the 4 metric cards from `groups[0]`/`groups[1]` (recall,
  precision, citation_accuracy + delta vs. previous group) and
  `groups[0].cases` (traces-passed count) — resolves Open Question 3 for the
  empty-history case.

### 5. Client — `EvalsTab/styles.ts` additions

Add style tokens for: the metrics-card row/card, the delta indicator
(reusing the existing `up ? "var(--ok)" : "var(--crit)"` convention already
used in the Compare section, `EvalsTab.tsx:211`), the bordered
MUST-FIND/MUST-NOT-FLAG badge variant (via `Badge`'s existing `style` prop
override — no new component needed, e.g. `{ border: "1px solid
var(--accent)", background: "transparent", color: "var(--accent)" }` for
MUST FIND vs. a neutral border for MUST NOT FLAG), the muted subtitle line,
and the muted severity-category tag.

### 6. Client — `EvalsTab.tsx` restructure

- Add the metrics-card block above the case list: `SectionLabel` (reuse from
  `@devdigest/ui`, matching `EvalDashboardView`'s heading pattern —
  see Recommendation below) + "View full dashboard →" link (`next/link` to
  `/eval-dashboard`) on the same row; 4 cards (RECALL/PRECISION/CITATION
  ACCURACY colored via `METRIC_COLOR`, with delta arrows; TRACES PASSED
  plain, "17/20"-style); caption line below ("Scoring is mechanical...").
  Resolve Open Question 3 for the no-history state.
- Rework the "Eval cases" section header: `SectionLabel` (or existing
  `<h2>`, per Recommendation) + passing-count badge (`casesPassingSummary`,
  amber) + muted "N cases" counter, then the two buttons **reordered** to
  match the mockup — "▷ Run all evals" (secondary) before "+ New eval case"
  (primary) — swapping the current order (`EvalsTab.tsx:120-133` currently
  has New Case, then Run All).
- Rework each case row: leading status icon (`Icon.CheckCircle` /
  `Icon.XCircle`, colored `var(--ok)`/`var(--crit)`) instead of/alongside the
  current pass/fail `Badge`; case name in `.mono` styling (global CSS class,
  `client/src/vendor/ui/styles.css:186`) immediately followed by the MUST
  FIND/MUST NOT FLAG badge; a muted subtitle line below the name ("expected N
  finding(s), got M") per `deriveCaseTag` + `last_run.actual_count`; on the
  right, the severity-category tag ("CRITICAL - security") or "assert empty"
  text; trailing icon-only ghost buttons for run (`icon="Play"`), edit
  (`icon="Pencil"`, calling the existing `setEditing(c.id)` — currently only
  reachable by clicking the case name; keep that too, or drop it in favor of
  the explicit icon, implementer's call as long as edit remains reachable),
  and delete (`icon="Trash"`, existing behavior unchanged).
- Leave the "Run all" mutation logic (`onRunAll`), the History section
  (`groups.map(...)`, `:176-190`), the compare-selection state/logic
  (`toggleGroupSelection`, `comparisonPair`, `:194-228`), and all existing
  error-handling (`rowErrors`, `runAllError`) **functionally unchanged** —
  only move their JSX to render below the new blocks.

### 7. Translations

Add new keys under `evalsTab` in `client/messages/en/eval.json` for: metric
card labels (recall/precision/citation accuracy/traces passed), delta text,
"View full dashboard" link label, the scoring-mechanical caption, the
passing-count badge format ("{passing} / {total} passing"), the cases-count
format ("{count} cases"), MUST FIND / MUST NOT FLAG badge labels, the
"expected N, got M" / "expected N findings" subtitle formats, and "assert
empty". Note: `evalsTab.metricsTitle`/`metricsSubtitle` already exist in this
file but are dead (unused anywhere — confirmed via `grep`) and their current
copy doesn't match the mockup's required text; either repurpose them with
new copy for the metrics-card heading/caption or remove them if superseded
by more specific new keys — don't leave both the stale and the new keys
sitting unused side by side.

## Must-have vs. nice-to-have

**Must-have (matches the mockup, required by the task brief):**
- 4-card metrics block with `METRIC_COLOR`-consistent coloring and deltas.
- Passing-count badge + cases counter + reordered Run all / New case buttons.
- Per-row: status icon, MUST FIND/MUST NOT FLAG badge, severity-category tag
  / assert-empty text, run/edit/delete icon actions.
- "expected N, got M" subtitle (requires the server `actual_count` change).
- Existing Run all / History / Compare sections preserved functionally,
  moved below.
- `METRIC_COLOR` reused, not reinvented.

**Nice-to-have (implementer's judgment, not blocking):**
- Exact pixel-for-pixel spacing/sizing match to the screenshot.
- Keeping the "click case name to edit" affordance in addition to the new
  explicit edit icon (vs. replacing it outright).
- Extracting the metric-card derivation into a standalone, independently
  unit-tested helper function vs. an inline `useMemo` in the component.
- Localizing the metric labels via `t()` vs. following `EvalDashboardView`'s
  hardcoded-English precedent (Open Question 5).

> **Recommendation:** use `SectionLabel` (`@devdigest/ui`) for both new
> headings ("Eval cases", the metrics block heading) instead of a raw
> `<h2>` — `EvalDashboardView` (the sibling page implementing this exact
> reference mockup) already uses `SectionLabel` for its headings
> (`EvalDashboardView.tsx:74,134`), so this keeps `EvalsTab` visually
> consistent with the one other place in the app already following this
> mockup, at zero extra cost. This is advisory — the plan's must-haves don't
> require it; the implementer may keep the existing `<h2>` if there's a
> reason not to align.

## Test plan

- `cd client && pnpm test` — full client suite (jsdom + RTL, `fetch` mocked).
  Update `EvalsTab.test.tsx` for the new row markup: the existing tests that
  assert `screen.getByText("stripe-key-leak")`, `screen.getByText(/passed/)`,
  `screen.getByText("Run")` etc. will very likely break once the row is
  restructured (icon-only buttons instead of text `Run`, mono-styled name,
  new badge/tag elements) — these need real updates, not just left broken.
  Add new assertions for: metric-card values/deltas rendering from
  `groups[0]`/`groups[1]` fixtures, the passing-count badge text, the
  MUST FIND/MUST NOT FLAG badge + tag text per case, and the "expected N,
  got M" subtitle (extend the `cases` mock fixture with `last_run.actual_count`
  and `expected_output` entries). Watch for the `getByText` exact-match /
  duplicate-text pitfalls logged in `client/INSIGHTS.md` — in particular, do
  not build the severity-category tag as multiple `<Badge>{a} - {b}</Badge>`
  interpolations (2026-08-19 gotcha).
- `cd client && pnpm typecheck` — must pass after the `EvalCaseWithLastRun`
  type change and the new helper types.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — server
  unit suite; add/update a unit test (or extend `server/test/evals-helpers.test.ts`
  if that's where case-list scoring/shaping is unit-tested, otherwise a
  service-level test) asserting `list()` returns the correct `actual_count`
  for a case with a run whose `actualOutput` is a findings array, and `0`
  when `actualOutput` is null/not an array.
- `cd server && pnpm exec vitest run .it.test` (needs Docker) — nice-to-have,
  not required by this change (the field is additive, no schema change, and
  no existing `.it.test.ts` assertion appears to pin the exact shape of
  `GET /agents/:id/evals`'s `last_run` — confirmed by `grep`); run it if
  Docker is available to catch anything unexpected, but a red/skipped
  integration run should not block this change on its own.
- A pass looks like: both client and server unit suites green, `pnpm
  typecheck` clean in `client/`, and the rendered `EvalsTab` visually
  matching the mockup's four blocks (metrics cards → case list → Run all/
  History/Compare, in that order) when eyeballed via `pnpm dev` (or the
  `run` skill) against a seeded agent with a set-run history.

## Out of scope

Architecture review and security review are explicitly **not** part of this
plan or the executing agent's job — they belong to the separate
`plan-verifier` and `architecture`/`security` review agents in this
multi-agent chain. This plan also does not touch: the grounding gate, the
injection guard, any DB migration, `EvalCaseModal`'s own UI (only its
already-exported types are read, not modified), or the Eval Dashboard page's
own behavior beyond the `METRIC_COLOR` promotion (which is required to be a
no-op for `EvalDashboardView.tsx` itself, per step 3).
