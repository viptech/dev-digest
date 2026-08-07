import { homedir } from 'node:os';
import { join } from 'node:path';
// Relative cross-package source import (same precedent as git-working-diff.ts).
// Root CLAUDE.md: "Single read chokepoint: server/src/adapters/secrets/local.ts"
// — the CLI must reuse this class, never re-parse ~/.devdigest/secrets.json
// itself, so there's still exactly one place that ever reads that file.
import { LocalSecretsProvider } from '../../../server/src/adapters/secrets/local.js';
import type { SecretKey } from '@devdigest/shared';

/** Same path construction as `server/src/platform/config.ts`'s `secretsPath` default. */
const SECRETS_PATH = join(homedir(), '.devdigest', 'secrets.json');

const provider = new LocalSecretsProvider(SECRETS_PATH);

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  return provider.get(key);
}
