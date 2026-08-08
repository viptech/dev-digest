#!/bin/sh
# Cwd-independent entry point (same reason as mcp-server/start.sh): `tsx`
# resolves this package's tsconfig.json `paths` aliases (`@devdigest/shared`,
# `@devdigest/reviewer-core`) relative to the process's OWN working
# directory, so it must be run with cwd = this package's root.
#
# But `devdigest review --mode working` needs the CALLER's original working
# directory too — to find the git repo being reviewed, which is normally
# wherever the user's shell was when they ran this command, NOT mcp-server/.
# So: capture the caller's cwd BEFORE `cd`-ing here, and hand it to the CLI
# via an env var it reads instead of raw `process.cwd()`.
DEVDIGEST_CLI_CWD="$(pwd)"
export DEVDIGEST_CLI_CWD
cd "$(dirname "$0")/.." || exit 1
exec ./node_modules/.bin/tsx src/cli/review-working.ts "$@"
