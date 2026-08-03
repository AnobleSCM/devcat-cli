import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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

describe('$HOME is not a project root — when cwd IS $HOME', () => {
  // The guard nulls the upward hit, but the project pass then fell back to
  // join(cwd, '.claude', 'skills') — which, run from $HOME, IS the guarded
  // user root. Project-first dedupe then kept the whole user shelf as
  // project-scoped. `cd ~ && npx devcat-cli` is the commonest invocation
  // there is, and the earlier tests all used directories nested BENEATH
  // $HOME, so none of them reached this.
  function seedShelf(): void {
    const skills = join(tmpHome, '.claude', 'skills', 'panel');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'SKILL.md'), '# panel\n');
    const agents = join(tmpHome, '.claude', 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'debugger.md'), 'x');
  }

  it('does not claim user skills as project-scoped', async () => {
    seedShelf();
    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ cwd: tmpHome, scope: 'project' });
    expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
  });

  it('does not claim user subagents as project-scoped', async () => {
    seedShelf();
    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ cwd: tmpHome, scope: 'project' });
    expect(result.tools.filter((t) => t.type === 'subagent')).toEqual([]);
  });

  it('the whole scan from $HOME reports the shelf as user-wide, exactly once', async () => {
    seedShelf();
    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);

    const skills = result.tools.filter((t) => t.type === 'skill');
    const subagents = result.tools.filter((t) => t.type === 'subagent');
    expect(skills.map((t) => t.name)).toEqual(['panel']);
    expect(subagents.map((t) => t.name)).toEqual(['debugger']);
    expect([...skills, ...subagents].every((t) => t.scope === 'user')).toBe(true);
    expect(result.tools.filter((t) => t.scope === 'project')).toEqual([]);
  });

  it('sees through a symlinked route to $HOME', async () => {
    // A cwd that reaches $HOME by a different textual path — string equality
    // misses this, canonical comparison does not.
    seedShelf();
    const link = join(tmpdir(), `devcat-homelink-${process.pid}`);
    rmSync(link, { force: true });
    symlinkSync(tmpHome, link);
    try {
      const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
      const result = await detectClaudeCode({ cwd: link, scope: 'project' });
      expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
      expect(result.tools.filter((t) => t.type === 'subagent')).toEqual([]);
    } finally {
      rmSync(link, { force: true });
    }
  });

  it('a genuine project shelf inside $HOME is still project-scoped', async () => {
    seedShelf();
    const projectSkills = join(tmpHome, 'repo', '.claude', 'skills', 'repo-skill');
    mkdirSync(projectSkills, { recursive: true });
    writeFileSync(join(projectSkills, 'SKILL.md'), '# repo\n');

    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ cwd: join(tmpHome, 'repo'), scope: 'project' });
    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name)).toEqual(['repo-skill']);
    expect(skills[0]!.scope).toBe('project');
  });
});

describe('$HOME is not a project root — Codex and Cursor from $HOME', () => {
  function seedUserConfigs(): void {
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(join(tmpHome, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { figma: {} } }));
  }

  it('neither claims its user config as project-scoped when cwd is $HOME', async () => {
    seedUserConfigs();
    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const { detectCursor } = await import('../../../src/manifest/cursor.js');
    expect((await detectCodex({ cwd: tmpHome, scope: 'project' })).tools).toEqual([]);
    expect((await detectCursor({ cwd: tmpHome, scope: 'project' })).tools).toEqual([]);
  });

  it('neither REPORTS the user location from the project pass', async () => {
    // Attribution was already right, but the project pass still named the
    // user file as a location it checked — and the user pass names it too,
    // so the same place was listed twice.
    seedUserConfigs();
    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const { detectCursor } = await import('../../../src/manifest/cursor.js');
    expect((await detectCodex({ cwd: tmpHome, scope: 'project' })).pathsScanned).toEqual([]);
    expect((await detectCursor({ cwd: tmpHome, scope: 'project' })).pathsScanned).toEqual([]);
  });

  it('a real project config under $HOME is still reported as a scanned location', async () => {
    seedUserConfigs();
    mkdirSync(join(cwd, '.codex'), { recursive: true });
    writeFileSync(join(cwd, '.codex', 'config.toml'), '[mcp_servers.repo-local]\n');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const result = await detectCodex({ cwd, scope: 'project' });
    expect(result.pathsScanned).toEqual([join(cwd, '.codex', 'config.toml')]);
  });

  it('a missing project config still reports the candidate it looked for', async () => {
    // Only the user-root case is silent. An ordinary miss must still say
    // where it looked, which is what the empty-state message is built from.
    const { detectCursor } = await import('../../../src/manifest/cursor.js');
    const result = await detectCursor({ cwd, scope: 'project' });
    expect(result.pathsScanned).toEqual([join(cwd, '.cursor', 'mcp.json')]);
  });
});

describe('locations are reported once each when run from $HOME', () => {
  it('a full scan from $HOME lists every location exactly once', async () => {
    // README promises paths_checked holds one entry per config file or
    // directory consulted. Running from $HOME is where that was false.
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(join(tmpHome, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { figma: {} } }));
    const skills = join(tmpHome, '.claude', 'skills', 'panel');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'SKILL.md'), '# panel\n');
    mkdirSync(join(tmpHome, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'agents', 'debugger.md'), 'x');

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);

    const duplicates = result.pathsScanned.filter(
      (p, i) => result.pathsScanned.indexOf(p) !== i,
    );
    expect(duplicates).toEqual([]);
    expect(new Set(result.pathsScanned).size).toBe(result.pathsScanned.length);

    // The four guarded user locations each appear exactly once.
    for (const location of [
      join(tmpHome, '.claude', 'skills'),
      join(tmpHome, '.claude', 'agents'),
      join(tmpHome, '.codex', 'config.toml'),
      join(tmpHome, '.cursor', 'mcp.json'),
    ]) {
      expect(result.pathsScanned.filter((p) => p === location)).toHaveLength(1);
    }
  });

  it('lists each location once from a directory nested under $HOME too', async () => {
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(cwd);
    expect(new Set(result.pathsScanned).size).toBe(result.pathsScanned.length);
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
