import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end cover for the default (no-args) command: scan this machine,
 * print the stack. Both scopes are redirected at a fixture tree — homedir()
 * for user scope, process.cwd() for project scope — so the assertions do not
 * depend on whatever the test runner's real machine happens to have installed.
 *
 * node:os exports are non-configurable, so vi.mock + a holder is the supported
 * way to move homedir() (same pattern as unit/manifest/security.test.ts).
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
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-report-home-'));
  projectDir = mkdtempSync(join(tmpdir(), 'devcat-report-proj-'));

  // User scope: two Claude MCP servers + one installed plugin, one Codex MCP.
  writeFileSync(
    join(tmpHome, '.claude.json'),
    JSON.stringify({ mcpServers: { github: { command: 'npx' }, exa: { command: 'npx' } } }),
  );
  mkdirSync(join(tmpHome, '.claude', 'plugins'), { recursive: true });
  writeFileSync(
    join(tmpHome, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'swift-lsp@claude-plugins-official': [{}] } }),
  );
  mkdirSync(join(tmpHome, '.codex'), { recursive: true });
  writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\ncommand = "uv"\n');

  // Skills, one of them symlinked the way the real shelf link-farm is, plus
  // one dangling link and one non-skill file that must both be ignored.
  const canon = join(tmpHome, '.agents', 'skills', 'panel');
  mkdirSync(canon, { recursive: true });
  writeFileSync(join(canon, 'SKILL.md'), '# panel\n');
  const skillsRoot = join(tmpHome, '.claude', 'skills');
  mkdirSync(join(skillsRoot, 'handoff'), { recursive: true });
  writeFileSync(join(skillsRoot, 'handoff', 'SKILL.md'), '# handoff\n');
  symlinkSync(canon, join(skillsRoot, 'panel'));
  symlinkSync(join(tmpHome, 'gone'), join(skillsRoot, 'dangling'));
  writeFileSync(join(skillsRoot, 'AGENTS.md'), 'not a skill');

  // Subagents in both shapes Claude Code accepts.
  const agentsRoot = join(tmpHome, '.claude', 'agents');
  mkdirSync(join(agentsRoot, 'code-reviewer'), { recursive: true });
  writeFileSync(join(agentsRoot, 'code-reviewer', 'code-reviewer.md'), 'x');
  writeFileSync(join(agentsRoot, 'debugger.md'), 'x');

  // Project scope: one Cursor MCP server in the "current" directory.
  mkdirSync(join(projectDir, '.cursor'), { recursive: true });
  writeFileSync(
    join(projectDir, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { supabase: {} } }),
  );

  homedirHolder.current = tmpHome;
});

afterAll(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

async function runAndCapture(markdown: boolean): Promise<{ exitCode: number; out: string }> {
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
  try {
    const { runReport } = await import('../../src/commands/report.js');
    const exitCode = await runReport({ markdown });
    return { exitCode, out: chunks.join('') };
  } finally {
    writeSpy.mockRestore();
    cwdSpy.mockRestore();
  }
}

describe('report — default command', () => {
  it('scans the machine and prints every client it found, grouped', async () => {
    const { exitCode, out } = await runAndCapture(false);

    expect(exitCode).toBe(0);
    expect(out).toContain('Your AI-coding stack — 9 tools');
    // Claude Code: 2 MCP + 1 plugin + 2 skills + 2 subagents
    expect(out).toContain('Claude Code');
    expect(out).toMatch(/2 mcp\s+exa, github/);
    expect(out).toMatch(/1 plugin\s+swift-lsp/);
    expect(out).toMatch(/2 skill\s+handoff, panel/);
    expect(out).toMatch(/2 subagent\s+code-reviewer, debugger/);
    // Codex + Cursor each contribute one
    expect(out).toMatch(/1 mcp\s+serena/);
    expect(out).toMatch(/1 mcp\s+supabase/);
    expect(out).toContain('9 tools in Claude Code, Codex, and Cursor');
    // The Cursor entry came from the project directory.
    expect(out).toContain('1 project-scoped · 8 user-wide');
  });

  it('ignores dangling links and non-skill files in a skills directory', async () => {
    const { out } = await runAndCapture(false);
    expect(out).not.toContain('dangling');
    expect(out).not.toContain('AGENTS');
  });

  it('touches no network and no credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const { exitCode } = await runAndCapture(false);
      expect(exitCode).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('--markdown emits the shareable snippet from the same scan', async () => {
    const { exitCode, out } = await runAndCapture(true);

    expect(exitCode).toBe(0);
    expect(out.startsWith('## My AI stack')).toBe(true);
    expect(out).toContain('9 tools across Claude Code, Codex, and Cursor.');
    expect(out).toContain('- **MCP servers (2):** `exa`, `github`');
    expect(out).toContain('- **Plugins (1):** `swift-lsp`');
    expect(out).toContain('- **Skills (2):** `handoff`, `panel`');
    expect(out).toContain('- **Subagents (2):** `code-reviewer`, `debugger`');
    expect(out).toContain('### Cursor');
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('report — --json', () => {
  const originalArgv = process.argv;

  async function runJson(extraArgs: string[]): Promise<{ exitCode: number; out: string }> {
    process.argv = ['node', 'devcat', ...extraArgs];
    const { resetJsonModeCacheForTests } = await import('../../src/ui/jsonStream.js');
    resetJsonModeCacheForTests();
    try {
      return await runAndCapture(extraArgs.includes('--markdown'));
    } finally {
      process.argv = originalArgv;
      resetJsonModeCacheForTests();
    }
  }

  it('emits one parseable JSON object mirroring the report', async () => {
    const { exitCode, out } = await runJson(['--json']);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.total).toBe(9);
    expect(parsed.project_scoped).toBe(1);
    expect(parsed.user_scoped).toBe(8);
    expect(parsed.clients.map((c: { client: string }) => c.client)).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ]);
    const claude = parsed.clients[0];
    expect(claude.types.map((t: { type: string; count: number }) => [t.type, t.count])).toEqual([
      ['mcp', 2],
      ['plugin', 1],
      ['skill', 2],
      ['subagent', 2],
    ]);
    expect(parsed.paths_checked.length).toBeGreaterThan(0);
    // Not the human report, and not the NDJSON event stream sync emits.
    expect(out).not.toContain('Your AI-coding stack');
    expect(out.trimEnd().split('\n').filter((l) => l === '}')).toHaveLength(1);
  });

  it('wins over --markdown when both are passed', async () => {
    const { out } = await runJson(['--json', '--markdown']);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('## My AI stack');
  });
});
