import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Drives the REAL commander program over real argv arrays, so the parser,
 * the default-command dispatch, and the flag wiring are all exercised —
 * not just the command function underneath them.
 *
 * runCli() is the whole of bin/devcat.ts apart from assigning the returned
 * code to process.exitCode, which cannot be exercised in-process here.
 * bin.exit.test.ts covers that assignment, and why it is an assignment
 * rather than a process.exit call.
 */
const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

process.env.NO_COLOR = '1';

let tmpHome: string;
let projectDir: string;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-cli-home-'));
  projectDir = mkdtempSync(join(tmpdir(), 'devcat-cli-proj-'));

  writeFileSync(
    join(tmpHome, '.claude.json'),
    JSON.stringify({ mcpServers: { github: {}, exa: {} } }),
  );
  const skills = join(tmpHome, '.claude', 'skills', 'handoff');
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, 'SKILL.md'), '# handoff\n');
  const agents = join(tmpHome, '.claude', 'agents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'debugger.md'), 'x');

  homedirHolder.current = tmpHome;
});

afterAll(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

/** Run the real parser over `argv` and capture stdout. */
async function invoke(argv: string[]): Promise<{ exitCode: number; out: string }> {
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
  try {
    const { runCli } = await import('../../src/cli.js');
    const exitCode = await runCli(['/usr/bin/node', '/usr/local/bin/devcat', ...argv]);
    return { exitCode, out: chunks.join('') };
  } finally {
    writeSpy.mockRestore();
    cwdSpy.mockRestore();
  }
}

describe('CLI entrypoint — real commander parse', () => {
  it('no args dispatches the default report command', async () => {
    const { exitCode, out } = await invoke([]);
    expect(exitCode).toBe(0);
    expect(out).toContain('Your AI-coding stack — 4 tools');
    expect(out).toMatch(/2 mcp\s+exa, github/);
    expect(out).toMatch(/1 skill\s+handoff/);
    expect(out).toMatch(/1 subagent\s+debugger/);
  });

  it('the explicit `report` subcommand behaves identically to no args', async () => {
    const bare = await invoke([]);
    const explicit = await invoke(['report']);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.out).toBe(bare.out);
  });

  it('--markdown reaches the default command as a real parsed flag', async () => {
    const { exitCode, out } = await invoke(['--markdown']);
    expect(exitCode).toBe(0);
    expect(out.startsWith('## My AI stack')).toBe(true);
    expect(out).toContain('- **Skills (1):** `handoff`');
  });

  it('--json is parsed at program level and still reaches the default command', async () => {
    // Commander consumes program-level flags before dispatching, so this is
    // the case that silently regressed when the flag was read off argv.
    const { exitCode, out } = await invoke(['--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.total).toBe(4);
    expect(parsed.clients[0].client).toBe('claude-code');
  });

  it('--json also works when passed to the subcommand directly', async () => {
    const { exitCode, out } = await invoke(['report', '--json']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(out).total).toBe(4);
  });

  it('--json wins over --markdown through the real parser', async () => {
    const { out } = await invoke(['--json', '--markdown']);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('## My AI stack');
  });

  it('an unknown flag returns exit 1 without killing the process', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('runCli must return an exit code, never terminate the process');
    }) as never);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { exitCode } = await invoke(['--definitely-not-a-flag']);
      expect(exitCode).toBe(1);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('--help and --version exit 0 through the same path', async () => {
    const help = await invoke(['--help']);
    expect(help.exitCode).toBe(0);
    expect(help.out).toContain('Usage: devcat');
    expect(help.out).toContain('report');
    expect(help.out).toContain('sync');

    const version = await invoke(['--version']);
    expect(version.exitCode).toBe(0);
    expect(version.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
