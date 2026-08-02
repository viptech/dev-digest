import { CONFIG_FILE_CANDIDATES } from './constants.js';

/** Minimal shape this module needs from RepoIntelService — kept narrow so
 *  it's trivially mockable in tests without importing the real interface. */
export interface SampleSelectionRepoIntel {
  getConventionSamples(repoId: string, n: number): Promise<string[]>;
  readFiles(repoId: string, paths: string[]): Promise<{ path: string; content: string }[]>;
}

/**
 * Code-only sample selection (no LLM call): root-level config files that
 * actually exist in the clone, plus the top-N ranked files from repo-intel.
 * Deduplicated. Used when `sampling_mode: 'code'` (the default per the
 * homework brief — deterministic, cheaper than the 'llm' file-selection
 * step).
 */
export async function getCodeOnlySamples(
  repoIntel: SampleSelectionRepoIntel,
  repoId: string,
  n: number,
): Promise<string[]> {
  const [existingConfigs, ranked] = await Promise.all([
    repoIntel.readFiles(repoId, [...CONFIG_FILE_CANDIDATES]).then((files) => files.map((f) => f.path)),
    repoIntel.getConventionSamples(repoId, n),
  ]);
  return [...new Set([...existingConfigs, ...ranked])];
}
