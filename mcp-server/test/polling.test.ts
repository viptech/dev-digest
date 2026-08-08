import { describe, it, expect } from 'vitest';
import { pollRunUntilTerminal } from '../src/polling.js';
import { fakeHttp, instantClock } from './support/fake-http.js';
import { runSummaryFixture } from './support/fixtures.js';

describe('pollRunUntilTerminal', () => {
  it('returns immediately once the run is done', async () => {
    const http = fakeHttp({ get: () => [runSummaryFixture({ status: 'done' })] });
    const outcome = await pollRunUntilTerminal(
      http,
      'pull-1',
      'run-1',
      { timeoutMs: 60_000, intervalMs: 2_000 },
      instantClock(),
    );
    expect(outcome.status).toBe('done');
  });

  it('returns failed with the run row (error message reachable by callers)', async () => {
    const http = fakeHttp({ get: () => [runSummaryFixture({ status: 'failed', error: 'LLM crashed' })] });
    const outcome = await pollRunUntilTerminal(
      http,
      'pull-1',
      'run-1',
      { timeoutMs: 60_000, intervalMs: 2_000 },
      instantClock(),
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'running') expect(outcome.run.error).toBe('LLM crashed');
  });

  it('returns cancelled the same way as failed', async () => {
    const http = fakeHttp({ get: () => [runSummaryFixture({ status: 'cancelled', error: null })] });
    const outcome = await pollRunUntilTerminal(
      http,
      'pull-1',
      'run-1',
      { timeoutMs: 60_000, intervalMs: 2_000 },
      instantClock(),
    );
    expect(outcome.status).toBe('cancelled');
  });

  it('returns running (not an error) once the timeout budget elapses', async () => {
    const http = fakeHttp({ get: () => [runSummaryFixture({ status: 'running' })] });
    const outcome = await pollRunUntilTerminal(
      http,
      'pull-1',
      'run-1',
      { timeoutMs: 6_000, intervalMs: 2_000 },
      instantClock(),
    );
    expect(outcome.status).toBe('running');
    expect(outcome.run?.run_id).toBe('run-1');
  });
});
