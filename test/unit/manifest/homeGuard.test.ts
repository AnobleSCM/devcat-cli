import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression cover for all three detectors: $HOME is an ancestor of most
 * working directories, so an unguarded upward walk finds the user's own
 * config and reports it as project-scoped.
 *
 * Every detector here has a user-scope reader for the same path, so the
 * project pass must skip it — nothing is detected less, it is attributed
 * correctly. Claude Code had cover for this; Codex and Cursor did not, and
 * their half of the guard was once left out of a commit unnoticed.
 */
const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

let tmpHome: string;
let cwd: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-homeguard-'));
  homedirHolder.current = tmpHome;
  // A working directory nested under $HOME, like any repo in ~/Developer.
  cwd = join(tmpHome, 'Developer', 'some-repo');
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('$HOME is not a project root — Codex', () => {
  it('does not report ~/.codex/config.toml as project-scoped', async () => {
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const project = await detectCodex({ cwd, scope: 'project' });
    expect(project.tools).toEqual([]);

    // Still detected — by the user pass, with the right scope.
    const user = await detectCodex({ scope: 'user' });
    expect(user.tools.map((t) => t.name)).toContain('serena');
    expect(user.tools.every((t) => t.scope === 'user')).toBe(true);
  });

  it('still finds a genuine project-level .codex/config.toml under $HOME', async () => {
    mkdirSync(join(cwd, '.codex'), { recursive: true });
    writeFileSync(join(cwd, '.codex', 'config.toml'), '[mcp_servers.repo-local]\n');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const result = await detectCodex({ cwd, scope: 'project' });
    expect(result.tools.map((t) => t.name)).toEqual(['repo-local']);
    expect(result.tools[0]!.scope).toBe('project');
  });
});

describe('$HOME is not a project root — Cursor', () => {
  it('does not report ~/.cursor/mcp.json as project-scoped', async () => {
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(join(tmpHome, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { figma: {} } }));

    const { detectCursor } = await import('../../../src/manifest/cursor.js');
    const project = await detectCursor({ cwd, scope: 'project' });
    expect(project.tools).toEqual([]);

    const user = await detectCursor({ scope: 'user' });
    expect(user.tools.map((t) => t.name)).toContain('figma');
    expect(user.tools.every((t) => t.scope === 'user')).toBe(true);
  });

  it('still finds a genuine project-level .cursor/mcp.json under $HOME', async () => {
    mkdirSync(join(cwd, '.cursor'), { recursive: true });
    writeFileSync(join(cwd, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { 'repo-local': {} } }));

    const { detectCursor } = await import('../../../src/manifest/cursor.js');
    const result = await detectCursor({ cwd, scope: 'project' });
    expect(result.tools.map((t) => t.name)).toEqual(['repo-local']);
    expect(result.tools[0]!.scope).toBe('project');
  });
});

describe('$HOME is not a project root — whole scan', () => {
  it('reports a user-only machine as entirely user-scoped', async () => {
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(join(tmpHome, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { figma: {} } }));
    const skills = join(tmpHome, '.claude', 'skills', 'panel');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'SKILL.md'), '# panel\n');

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(cwd);

    expect(result.tools.length).toBeGreaterThanOrEqual(3);
    expect(result.tools.filter((t) => t.scope === 'project')).toEqual([]);
  });
});
