#!/bin/sh
# Cwd-independent entry point. `tsx` resolves this package's tsconfig.json
# `paths` alias (`@devdigest/shared`) relative to the process's *working
# directory*, not the entry file's location — so any MCP client that spawns
# this server without setting `cwd` explicitly (confirmed: Claude Code's
# `claude mcp add`/`add-json` silently drops a `cwd` field) would otherwise
# fail with `ERR_MODULE_NOT_FOUND: Cannot find package '@devdigest/shared'`.
# `cd` here first makes this script correct regardless of the caller's cwd.
cd "$(dirname "$0")" || exit 1
exec ./node_modules/.bin/tsx src/index.ts
