import { vi } from 'vitest';
import type { HttpClient } from '../../src/http-client.js';
import type { PollClock } from '../../src/polling.js';

export interface FakeRoutes {
  get?: (path: string) => unknown | Promise<unknown>;
  post?: (path: string, body?: unknown) => unknown | Promise<unknown>;
}

/** Fake `HttpClient` — no real network. Route a GET/POST by path, mirroring
 * the "mock the outside world" spirit of `server/src/adapters/mocks.ts`
 * (a fake implementation of the interface, not a module-level fetch mock). */
export function fakeHttp(routes: FakeRoutes = {}): HttpClient & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async (path: string) => {
      if (!routes.get) throw new Error(`fakeHttp: unexpected GET ${path}`);
      return routes.get(path);
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      if (!routes.post) throw new Error(`fakeHttp: unexpected POST ${path}`);
      return routes.post(path, body);
    }),
  };
}

/** Deterministic, instant "clock" for polling.ts tests — no real wall-clock
 * waiting. `sleep` just advances the counter `now()` reads from, so a
 * timeout budget elapses after a bounded number of loop iterations. */
export function instantClock(): PollClock {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  };
}
