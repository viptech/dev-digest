import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './classification-rules.js';

/**
 * Deterministic file → risk-role classifier. Pure, path-only (never looks at
 * additions/deletions/patch — those only roll into display, not the role) and
 * has zero I/O. Never imports `resolveFeatureModel` or calls `container.llm`;
 * this is the whole point of Smart Diff — no new LLM call anywhere.
 *
 * Match order: boilerplate (most specific, unconditional) → wiring → core
 * (the fallback — business logic can't be pattern-matched exhaustively by
 * path, so it's "didn't match a more specific pattern", not a positive list).
 */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((re) => re.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(path))) return 'wiring';
  return 'core';
}
