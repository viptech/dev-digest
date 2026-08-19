import type { EvalExpectation } from "@devdigest/shared";

/** true when text is empty (treated as "no override") or valid JSON. */
export function isValidJson(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Template inserted by the "Finding skeleton" button (SPEC-05 T13) — a
 *  manual-authoring aid, available regardless of seeded/manual mode. `title`
 *  isn't part of the `EvalExpectation` contract; it's stripped server-side
 *  (a plain, non-`.strict()` zod object) and is here purely as an authoring
 *  hint for whoever fills in the skeleton by hand. */
const SKELETON_EXPECTATION = {
  type: "must_find",
  file: "",
  start_line: 0,
  end_line: 0,
  severity: "WARNING",
  category: "",
  title: "",
};

/** Appends one template `EvalExpectation` to the current expected-output
 *  JSON text and re-stringifies it. Falls back to a fresh single-item array
 *  when the current text isn't a valid JSON array (empty textarea, invalid
 *  JSON mid-edit, etc.) — never throws. */
export function appendSkeletonExpectation(expectedText: string): string {
  let arr: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(expectedText);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    // invalid/empty current text — start a fresh array instead of throwing.
  }
  arr.push(SKELETON_EXPECTATION);
  return JSON.stringify(arr, null, 2);
}

/** Parses the distinct file paths touched by a unified diff, from its
 *  `diff --git a/<path> b/<path>` headers (Files tab, SPEC-05 T13) — pure
 *  derivation from the diff text already in state, no new data source. */
export function parseDiffFilePaths(diff: string): string[] {
  const paths = new Set<string>();
  const re = /^diff --git a\/(.+) b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diff))) {
    const path = m[2] ?? m[1];
    if (path) paths.add(path);
  }
  return Array.from(paths);
}

export interface ExpectationSummary {
  kind: EvalExpectation["type"];
  /** Fully-formed human summary, e.g. `MUST find "Hardcoded secret" at
   *  src/config.ts:11` — built in code (not through next-intl) since it's
   *  data-derived content, the same treatment findings' own title/file/
   *  rationale already get elsewhere in this app. */
  text: string;
}

/** Derives the POSITIVE/NEGATIVE CASE badge + human summary whenever
 *  `expected_output` has EXACTLY one entry (seeded or manually edited to
 *  that shape — not exclusive to seeded mode, per SPEC-05 T13). `title`
 *  prefers the PR-meta title field when present, else falls back to the
 *  file path alone. Returns `null` for invalid JSON or any other count of
 *  entries (0, or 2+). */
export function deriveExpectationSummary(expectedText: string, title: string): ExpectationSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(expectedText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  const entry = parsed[0] as Partial<EvalExpectation> | undefined;
  if (entry?.type !== "must_find" && entry?.type !== "must_not_flag") return null;
  const location = entry.start_line != null ? `${entry.file ?? ""}:${entry.start_line}` : (entry.file ?? "");
  const verb = entry.type === "must_find" ? "MUST find" : "MUST NOT flag";
  const trimmed = title.trim();
  const text = trimmed ? `${verb} "${trimmed}" at ${location}` : `${verb} ${location}`;
  return { kind: entry.type, text };
}
