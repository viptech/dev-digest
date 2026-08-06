/**
 * Thin fetch wrapper against the DevDigest API. Base URL defaults to the local
 * dev server (`http://localhost:3001`), overridable via `DEVDIGEST_API_URL`
 * (see README.md). No auth headers — the API's `LocalNoAuthProvider` always
 * resolves the same local workspace/user (confirmed in the plan's Constraints
 * section), so nothing to attach here.
 *
 * Every non-2xx response throws a typed `ApiError` carrying the HTTP status
 * and the parsed (or raw-text) response body, so callers (resolvers, tool
 * handlers) can map it to a tool-specific, user-facing message instead of
 * leaking a raw HTTP body to the MCP client.
 */

const BASE_URL = process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001';

export interface ApiErrorInit {
  status: number;
  body: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor({ status, body }: ApiErrorInit) {
    super(`DevDigest API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });

  const text = await res.text();
  const parsed: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!res.ok) {
    throw new ApiError({ status: res.status, body: parsed });
  }

  return parsed as T;
}

/** Default client, talking to the real API. Tools/resolvers/polling accept an
 * `HttpClient` as an injectable dependency (defaulting to this singleton) so
 * unit tests can pass a fake implementation with no real network calls. */
export const httpClient: HttpClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
