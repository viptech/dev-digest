import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';

/**
 * Regression tests for the three `tryPersistentBlast` bugs fixed in
 * `repo-intel/service.ts` (per-symbol caller cap, 2-hop endpoint reach, and
 * the `status: 'partial'` degraded flag). Same stub-`svc.repo` pattern as
 * `repo-intel-facade-degraded.test.ts:19-38` — no Postgres, no clone.
 *
 * Each test drives the fix through the PUBLIC `getBlastRadius` entry point
 * (not the private `tryPersistentBlast`) — with `repoIntelEnabled: true` and
 * `tryGetIndexState` returning a usable status, `tryPersistentBlast` always
 * returns non-null, so `getBlastRadius` returns it directly without falling
 * through to the ripgrep path.
 */

interface RepoStubOpts {
  status: 'full' | 'partial';
  /** getSymbolRows(repoId, paths) — routed by whether `paths` are the
   *  "changed files" set (decl rows) or something else (caller symbol rows,
   *  empty by default so `enclosingFromRows` falls back to the filename). */
  declRowsByChangedFile?: Record<string, { name: string; kind: string }[]>;
  callerRows?: { fromPath: string; toSymbol: string; line: number; rank: number }[];
  edges?: { fromFile: string; toFile: string }[];
  fileFacts?: Record<string, { endpoints: string[]; crons: string[] }>;
}

function buildService(opts: RepoStubOpts): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  const changedFiles = Object.keys(opts.declRowsByChangedFile ?? {});

  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: opts.status }),
    getSymbolRows: async (_repoId: string, paths: string[]) => {
      // Only the "changed files" call yields decl rows — any other call
      // (caller-file symbol lookup) returns [] so the enclosing-symbol
      // fallback (filename) kicks in, which is fine for these fixtures.
      const isChangedFilesCall = paths.length > 0 && paths.every((p) => changedFiles.includes(p));
      if (!isChangedFilesCall) return [];
      const rows: { path: string; name: string; kind: string; line: number; endLine: number; exported: boolean; signature: string | null }[] = [];
      for (const path of paths) {
        for (const s of opts.declRowsByChangedFile?.[path] ?? []) {
          rows.push({ path, name: s.name, kind: s.kind, line: 1, endLine: 3, exported: true, signature: null });
        }
      }
      return rows;
    },
    getResolvedCallers: async () => opts.callerRows ?? [],
    getEdges: async () => opts.edges ?? [],
    getFileFacts: async (_repoId: string, files: string[]) =>
      files
        .filter((f) => opts.fileFacts?.[f])
        .map((f) => ({ filePath: f, endpoints: opts.fileFacts![f]!.endpoints, crons: opts.fileFacts![f]!.crons })),
  };
  return svc;
}

describe('tryPersistentBlast — bug #1: per-viaSymbol caller cap (not global)', () => {
  it('25 callers for symbol A + 25 for symbol B -> exactly 20 each survive', async () => {
    const callerRows: { fromPath: string; toSymbol: string; line: number; rank: number }[] = [];
    for (let i = 0; i < 25; i++) {
      callerRows.push({ fromPath: `callerA${i}.ts`, toSymbol: 'symA', line: i + 1, rank: i });
      callerRows.push({ fromPath: `callerB${i}.ts`, toSymbol: 'symB', line: i + 1, rank: i });
    }
    const svc = buildService({
      status: 'full',
      declRowsByChangedFile: {
        'fileA.ts': [{ name: 'symA', kind: 'function' }],
        'fileB.ts': [{ name: 'symB', kind: 'function' }],
      },
      callerRows,
    });

    const blast = await svc.getBlastRadius('r1', ['fileA.ts', 'fileB.ts']);
    const symACallers = blast.callers.filter((c) => c.viaSymbol === 'symA');
    const symBCallers = blast.callers.filter((c) => c.viaSymbol === 'symB');
    // Would fail pre-fix: a 50-row global cap would keep only 20 total,
    // starving one symbol entirely (order-dependent on the merge).
    expect(symACallers).toHaveLength(20);
    expect(symBCallers).toHaveLength(20);
  });
});

describe("tryPersistentBlast — bug #3: status:'partial' is honestly degraded", () => {
  it("early return (no changed symbols found) -> degraded:true, reason:'index_partial'", async () => {
    const svc = buildService({ status: 'partial', declRowsByChangedFile: { 'fileA.ts': [] } });
    const blast = await svc.getBlastRadius('r1', ['fileA.ts']);
    expect(blast.changedSymbols).toEqual([]);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('index_partial');
  });

  it('main return (changed symbols + callers found) -> degraded:true, reason:\'index_partial\'', async () => {
    const svc = buildService({
      status: 'partial',
      declRowsByChangedFile: { 'fileA.ts': [{ name: 'symA', kind: 'function' }] },
      callerRows: [{ fromPath: 'caller.ts', toSymbol: 'symA', line: 5, rank: 1 }],
    });
    const blast = await svc.getBlastRadius('r1', ['fileA.ts']);
    expect(blast.changedSymbols).toHaveLength(1);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('index_partial');
  });

  it("status:'full' -> degraded:false, reason left unset (not falsely 'index_partial')", async () => {
    const svc = buildService({
      status: 'full',
      declRowsByChangedFile: { 'fileA.ts': [{ name: 'symA', kind: 'function' }] },
    });
    const blast = await svc.getBlastRadius('r1', ['fileA.ts']);
    expect(blast.degraded).toBe(false);
    expect(blast.reason).toBeUndefined();
  });
});

describe('tryPersistentBlast — bug #2: 2-hop reverse-import-graph walk from the changed file', () => {
  it('routeFile -> serviceFile -> changedFile chain: only serviceFile calls the symbol directly, only routeFile has an endpoint — the endpoint still surfaces', async () => {
    const svc = buildService({
      status: 'full',
      declRowsByChangedFile: { 'changedFile.ts': [{ name: 'sharedHelper', kind: 'function' }] },
      callerRows: [{ fromPath: 'serviceFile.ts', toSymbol: 'sharedHelper', line: 10, rank: 5 }],
      edges: [
        { fromFile: 'serviceFile.ts', toFile: 'changedFile.ts' }, // 1 hop
        { fromFile: 'routeFile.ts', toFile: 'serviceFile.ts' }, // 2 hops
      ],
      fileFacts: {
        // Would fail pre-fix: old code only unions facts for DIRECT caller
        // files (serviceFile.ts), never reaching routeFile.ts (2 hops away).
        'routeFile.ts': { endpoints: ['GET /x'], crons: [] },
      },
    });

    const blast = await svc.getBlastRadius('r1', ['changedFile.ts']);
    expect(blast.impactedEndpoints).toContain('GET /x');
    expect(blast.factsByFile?.['changedFile.ts']?.endpoints).toContain('GET /x');
  });
});

describe('tryPersistentBlast — bug #4: test files reached by the 2-hop walk do not pollute endpoints', () => {
  it("an *.it.test.ts file 2 hops away (importing app.ts to build a test harness) is excluded, even though it has 'endpoint-shaped' facts (e.g. app.inject({method,url}) call sites)", async () => {
    const svc = buildService({
      status: 'full',
      declRowsByChangedFile: { 'changedFile.ts': [{ name: 'sharedHelper', kind: 'function' }] },
      callerRows: [{ fromPath: 'app.ts', toSymbol: 'sharedHelper', line: 10, rank: 5 }],
      edges: [
        { fromFile: 'app.ts', toFile: 'changedFile.ts' }, // 1 hop
        { fromFile: 'test/agents-versions.it.test.ts', toFile: 'app.ts' }, // 2 hops — imports app.ts for its test harness
        { fromFile: 'routeFile.ts', toFile: 'app.ts' }, // 2 hops — a real route file
      ],
      fileFacts: {
        // extractEndpoints() false-positives on app.inject({method,url})
        // test calls — these must never surface as "impacted" endpoints.
        'test/agents-versions.it.test.ts': { endpoints: ['POST /agents', 'GET /agents/${agentId}/versions'], crons: [] },
        // A real route file 2 hops away must still surface (this is bug #2's
        // own scenario — confirms the test-file filter doesn't over-exclude).
        'routeFile.ts': { endpoints: ['GET /real-route'], crons: [] },
      },
    });

    const blast = await svc.getBlastRadius('r1', ['changedFile.ts']);
    expect(blast.impactedEndpoints).not.toContain('POST /agents');
    expect(blast.impactedEndpoints).not.toContain('GET /agents/${agentId}/versions');
    expect(blast.impactedEndpoints).toContain('GET /real-route');
  });
});
