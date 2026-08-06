/**
 * Poll `GET /pulls/:id/runs` until the target run reaches a terminal status
 * (anything other than `'running'`) or the time budget elapses. `RunSummary.status`
 * is typed as a plain string in the shared contract but is documented there as
 * `running | done | failed | cancelled` (trace.ts) — this module treats any
 * non-null, non-'running' value as terminal.
 */

import type { RunSummary } from '@devdigest/shared';
import type { HttpClient } from './http-client.js';

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
}

export type TerminalStatus = 'done' | 'failed' | 'cancelled';

export type PollOutcome =
  | { status: TerminalStatus; run: RunSummary }
  | { status: 'running'; run: RunSummary | undefined };

/** Injectable clock/sleep so tests can simulate the ~60s budget instantly
 * (no real wall-clock waiting) — defaults to the real `Date.now`/`setTimeout`. */
export interface PollClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: PollClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function pollRunUntilTerminal(
  http: HttpClient,
  pullId: string,
  runId: string,
  { timeoutMs, intervalMs }: PollOptions,
  clock: PollClock = realClock,
): Promise<PollOutcome> {
  const deadline = clock.now() + timeoutMs;
  let lastRun: RunSummary | undefined;

  while (true) {
    const runs = await http.get<RunSummary[]>(`/pulls/${pullId}/runs`);
    const run = runs.find((r) => r.run_id === runId);
    lastRun = run;

    if (run?.status && run.status !== 'running') {
      return { status: run.status as TerminalStatus, run };
    }

    if (clock.now() >= deadline) {
      return { status: 'running', run: lastRun };
    }

    await clock.sleep(intervalMs);
  }
}
