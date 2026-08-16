/** Read a File as UTF-8 text (client-side; no multipart upload — the server
 *  only ever sees a JSON string body). */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * SPEC-01 (Project Context) — the "SERIALIZES AS" illustrative preview
 * (mockup: Skill Editor · Context tab). Display-only: the real union-into-
 * `## Project context` behavior is entirely server-side
 * (`ReviewRunExecutor.buildProjectContextDigest`) — this never reproduces
 * that, it's just a human-readable "what does this skill contribute" hint.
 */
export function serializesAs(docs: { path: string }[]): string {
  if (docs.length === 0) return "## Project specifications\n(none attached)";
  return `## Project specifications\n${docs.map((d) => `- ${d.path}`).join("\n")}`;
}
