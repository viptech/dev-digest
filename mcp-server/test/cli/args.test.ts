import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('parses --mode and --agent', () => {
    expect(parseArgs(['--mode', 'working', '--agent', 'Security Reviewer'])).toEqual({
      mode: 'working',
      agent: 'Security Reviewer',
      help: false,
    });
  });

  it('parses -h / --help without requiring other flags', () => {
    expect(parseArgs(['-h'])).toEqual({ help: true });
    expect(parseArgs(['--help'])).toEqual({ help: true });
  });

  it('defaults mode/agent to undefined and help to false when absent', () => {
    expect(parseArgs([])).toEqual({ help: false });
  });

  it('order-independent', () => {
    expect(parseArgs(['--agent', 'X', '--mode', 'working'])).toEqual({
      mode: 'working',
      agent: 'X',
      help: false,
    });
  });
});
