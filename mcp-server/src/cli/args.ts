/** Pure argv parsing — no I/O, no `process.argv` reference (the caller passes it in). */
export interface ParsedArgs {
  mode?: string;
  agent?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') out.help = true;
    else if (arg === '--mode') out.mode = argv[++i];
    else if (arg === '--agent') out.agent = argv[++i];
  }
  return out;
}
