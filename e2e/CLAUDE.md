# e2e/CLAUDE.md

Package-local notes for `@devdigest/e2e`. Read `e2e/README.md` first for the
flow-spec format and the hermetic-runner precondition — this file only holds
the two mistakes that are easy to make from habit.

## Gotchas

- **Never the AI `chat` command** — specs use only deterministic locators
  (`--url`, `--text`, `find role|text|label`) so runs are stable and key-free.
- **Never `docker compose down -v`** to "reset" for a flow run — that deletes
  the `devdigest_pgdata` volume (every imported repo/review). Use
  `./scripts/e2e.sh` (hermetic, isolated ports) instead.
