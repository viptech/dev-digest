/** How many top-ranked files repo-intel offers as extraction candidates. */
export const SAMPLE_COUNT = 15;
/** Cap on how many of those the model may select to actually read (cost control). */
export const MAX_SELECTED_FILES = 8;
/** Per-file content cap sent to the extraction call (token-budget guard, same
 *  pattern as reviewer-core's MAX_PR_DESCRIPTION_CHARS). */
export const MAX_FILE_CHARS = 4000;
/** Cap on how many rule candidates one extraction run persists. */
export const MAX_CANDIDATES = 10;
/** Root-level config files worth reading as convention evidence, checked
 *  for existence before being added to the extraction sample (code-only
 *  sampling mode — no LLM call to pick these). */
export const CONFIG_FILE_CANDIDATES: readonly string[] = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
];
