import type { BlastRadius, DownstreamImpact } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { BlastCallerRow, BlastResult } from '../repo-intel/types.js';
import type { SmartDiffRepo } from '../smart-diff/repository.js';

/**
 * Blast Radius module — GET /pulls/:id/blast. Wiring-only: fetches the PR's
 * already-imported changed-file paths (`SmartDiffRepository.getPrFiles`,
 * no new DB access) and asks `container.repoIntel` (the ONLY door into
 * index-read logic, per onion-architecture) for the blast result, then maps
 * it into the wire `BlastRadius` shape. NEVER constructs `RepoIntelService`
 * directly, and NEVER calls an LLM — `summary` is a deterministic string.
 */
export class BlastService {
  constructor(
    private container: Container,
    private files: Pick<SmartDiffRepo, 'getPrFiles'>,
  ) {}

  async build(prId: string, repoId: string): Promise<BlastRadius> {
    const prFiles = await this.files.getPrFiles(prId);
    const blast = await this.container.repoIntel.getBlastRadius(
      repoId,
      prFiles.map((f) => f.path),
    );
    return assembleBlastRadius(blast);
  }
}

/**
 * Pure mapping (unit-testable with a plain `BlastResult` fixture, no I/O).
 * Groups `b.callers` by `viaSymbol` into `downstream[]` entries; each entry's
 * `endpoints_affected`/`crons_affected` are read from `b.factsByFile`, keyed
 * by the declaring (changed) file of that `viaSymbol` — see repo-intel's
 * `BlastResult.factsByFile` doc comment for why that's the correct key.
 */
export function assembleBlastRadius(b: BlastResult): BlastRadius {
  const changedSymbolByName = new Map(b.changedSymbols.map((s) => [s.name, s]));

  const callersByViaSymbol = new Map<string, BlastCallerRow[]>();
  for (const c of b.callers) {
    const arr = callersByViaSymbol.get(c.viaSymbol);
    if (arr) arr.push(c);
    else callersByViaSymbol.set(c.viaSymbol, [c]);
  }

  const downstream: DownstreamImpact[] = [...callersByViaSymbol.entries()].map(
    ([viaSymbol, callers]) => {
      const declFile = changedSymbolByName.get(viaSymbol)?.file;
      const facts = declFile ? b.factsByFile?.[declFile] : undefined;
      return {
        symbol: viaSymbol,
        // `rank` is a server-internal sort key — dropped at the wire boundary.
        callers: callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
        endpoints_affected: facts?.endpoints ?? [],
        crons_affected: facts?.crons ?? [],
      };
    },
  );

  const summary = `${b.changedSymbols.length} symbol(s) changed, ${b.callers.length} caller(s), ${b.impactedEndpoints.length} endpoint(s) potentially affected`;

  return {
    changed_symbols: b.changedSymbols.map((s) => ({ file: s.file, name: s.name, kind: s.kind })),
    downstream,
    summary,
    ...(b.degraded !== undefined ? { degraded: b.degraded } : {}),
    ...(b.reason !== undefined ? { reason: b.reason } : {}),
  };
}
