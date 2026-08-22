import { zipSync, strToU8 } from "fflate";
import type { CiExportInputBody, CiFile } from "@devdigest/shared";
import { MEMORY_FILE_PATH } from "./constants";

export interface TriggerState {
  opened: boolean;
  synchronize: boolean;
  reopened: boolean;
}

/** Exact defaults AC-13 requires — independent of `CiExportInput.triggers`'s
 *  own `.default()` in the contract (which stays `['opened','synchronize',
 *  'reopened']` for callers outside the wizard); the wizard always sends an
 *  explicit array built from this state. */
export const DEFAULT_TRIGGERS: TriggerState = { opened: true, synchronize: true, reopened: false };

export function selectedTriggerList(triggers: TriggerState): string[] {
  return (Object.keys(triggers) as (keyof TriggerState)[]).filter((key) => triggers[key]);
}

/** AC-14 — Install must be disabled when every trigger checkbox is off. */
export function noTriggersSelected(triggers: TriggerState): boolean {
  return selectedTriggerList(triggers).length === 0;
}

export type PostAs = "github_review" | "pr_comment" | "none";
export type InstallMethod = "open_pr" | "files";

export function buildExportInput(params: {
  repo: string;
  action: "files" | "open_pr";
  postAs: PostAs;
  triggers: TriggerState;
  /** AC-12 — Preview-step edits, keyed by file path. Passed through as
   *  `file_overrides` so Install writes/returns exactly what the editor
   *  showed, not a fresh server-regenerated copy. Omitted entirely (not an
   *  empty array) when there are no edits, to keep the request body minimal
   *  for the common case. */
  editedContents?: Record<string, string>;
}): CiExportInputBody {
  const overrides = params.editedContents
    ? Object.entries(params.editedContents).map(([path, contents]) => ({ path, contents }))
    : [];
  return {
    repo: params.repo.trim(),
    target: "gha",
    action: params.action,
    post_as: params.postAs,
    triggers: selectedTriggerList(params.triggers),
    base: "main",
    ...(overrides.length > 0 ? { file_overrides: overrides } : {}),
  };
}

/** AC-12 — every file is inline-editable in Preview EXCEPT the bundled
 *  runner (`editable: false` from the server) and `memory.jsonl`, which is
 *  `editable: true` at the contract level but the UI still hides its editor
 *  behind an "(empty — no memory recorded yet)" caption (Reconciliation
 *  point 10 of SPEC-08 — nothing to edit, no Memory module yet). */
export function isEditableInPreview(file: CiFile): boolean {
  return file.editable && file.path !== MEMORY_FILE_PATH;
}

/**
 * `action: 'files'` (Preview AND the "Copy files" Install path) returns
 * plain JSON (`CiFile[]`), never an actual `.zip` binary — the server has no
 * reason to produce one (Preview just needs the content for its editor).
 * Coordinator fix: an earlier revision of this function downloaded each file
 * individually via separate Blob + `<a download>` clicks (a real gap against
 * AC-20's literal "zip archive" wording, since `.devdigest/agents/<slug>.yaml`
 * and its sibling files landing as loose files in a Downloads folder — not a
 * single archive with the right relative paths — makes "add them manually"
 * meaningfully more error-prone). Now zips client-side via `fflate`
 * (dependency-free, browser-native `CompressionStream`-backed, added as a
 * direct `client` dependency — not a hand-rolled zip writer) and downloads
 * ONE `devdigest-ci-files.zip` preserving each file's full relative path
 * (`.devdigest/agents/...`, `.github/workflows/...`), so extracting it at
 * the target repo's root reproduces the exact layout `commitFiles` would
 * have written.
 */
export function downloadFilesAsZip(files: CiFile[], zipName = "devdigest-ci-files.zip"): void {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);
  const zipped = zipSync(entries, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
