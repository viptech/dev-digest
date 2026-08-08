/**
 * Tool-execution error shape + mapping. Per the MCP best-practice split
 * between Protocol Errors (malformed input — left entirely to the SDK's own
 * Zod-schema validation) and Tool Execution Errors (a well-formed call that
 * still can't succeed — repo not found, run not found, upstream API down):
 * every tool handler catches its own errors (ApiError from http-client.ts,
 * ResolutionError from resolvers.ts, or a handler-specific ToolError) and
 * returns `{ isError: true, content: [...] }` instead of throwing, so the
 * MCP client sees a normal tool result it can show the model, not a
 * transport-level failure.
 */

export interface ToolErrorContent {
  type: 'text';
  text: string;
}

export interface ToolErrorResult {
  isError: true;
  content: ToolErrorContent[];
  // The MCP SDK's CallToolResult is a "loose" zod object (allows/expects
  // arbitrary extra keys), which makes its inferred TS type carry an index
  // signature. Without this, TS rejects an otherwise-structurally-compatible
  // plain interface with "Index signature for type 'string' is missing".
  [key: string]: unknown;
}

/** Thrown by a tool handler for a tool-specific, user-facing failure that
 * isn't already a typed `ApiError`/`ResolutionError` (e.g. a terminal
 * failed/cancelled run). Message should always end pointed forward — e.g.
 * "call X to see/verify Y" — never a bare fact with nothing the caller can
 * do next. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Maps any caught error to the MCP tool-execution-error result shape. Never
 * leaks a raw stack trace or HTTP response body — the error's own `.message`
 * is expected to already be the clear, forward-leading text shown to the
 * caller (set at the throw site in resolvers.ts / the tool handler itself). */
export function toToolErrorResult(error: unknown): ToolErrorResult {
  const text = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text }] };
}
