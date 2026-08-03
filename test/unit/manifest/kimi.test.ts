import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectKimiCode } from '../../../src/manifest/kimi.js';

// Cross-platform homedir override (Pitfall 7): process.env.HOME doesn't
// affect os.homedir() on Windows. Mock node:os instead.
const homedirHolder: { current: string | null } = { current: null };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirHolder.current ?? actual.homedir(),
  };
});

describe('detectKimiCode — MCP servers', () => {
  let tmpHome: string | null = null;

  beforeEach(() => {
    homedirHolder.current = null;
  });

  afterEach(() => {
    homedirHolder.current = null;
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = null;
    }
  });

  it('parses mcpServers from ~/.kimi-code/mcp.json, emits ToolEntry with type=mcp, client=kimi-code', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-userscope-'));
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.kimi-code', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'demo-search': { command: 'npx', args: ['-y', '@example/demo-search-mcp'] },
          'demo-fetch': { command: 'npx', args: ['-y', '@example/demo-fetch-mcp'] },
        },
      }),
    );
    homedirHolder.current = tmpHome;
    const result = await detectKimiCode({ scope: 'user' });
    const mcp = result.tools.filter((t) => t.type === 'mcp');
    expect(mcp).toHaveLength(2);
    expect(mcp.find((t) => t.name === 'demo-search')).toBeDefined();
    expect(mcp.find((t) => t.name === 'demo-fetch')).toBeDefined();
    expect(mcp.every((t) => t.client === 'kimi-code')).toBe(true);
    expect(mcp.every((t) => t.scope === 'user')).toBe(true);
  });

  it('handles missing mcp.json gracefully (returns empty, pathsScanned lists all user locations)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-missing-'));
    homedirHolder.current = tmpHome;
    const result = await detectKimiCode({ scope: 'user' });
    expect(result.tools).toEqual([]);
    // User scope checks four locations: mcp.json, the brand skills root,
    // and the generic skills root (shared shelf).
    expect(result.pathsScanned).toEqual([
      join(tmpHome, '.kimi-code', 'mcp.json'),
      join(tmpHome, '.kimi-code', 'skills'),
      join(tmpHome, '.agents', 'skills'),
    ]);
  });

  it('handles malformed JSON gracefully (returns empty)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-bad-'));
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(join(tmpHome, '.kimi-code', 'mcp.json'), '{ not: valid json');
    homedirHolder.current = tmpHome;
    const result = await detectKimiCode({ scope: 'user' });
    expect(result.tools).toEqual([]);
    expect(result.pathsScanned).toContain(join(tmpHome, '.kimi-code', 'mcp.json'));
  });

  it('detects project-scope MCP config via a literal <cwd>/.kimi-code/mcp.json', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-proj-'));
    try {
      mkdirSync(join(projectDir, '.kimi-code'), { recursive: true });
      writeFileSync(
        join(projectDir, '.kimi-code', 'mcp.json'),
        JSON.stringify({ mcpServers: { 'repo-local': { command: 'npx' } } }),
      );
      const result = await detectKimiCode({ cwd: projectDir, scope: 'project' });
      const mcp = result.tools.filter((t) => t.type === 'mcp');
      expect(mcp).toHaveLength(1);
      expect(mcp[0]).toMatchObject({ type: 'mcp', name: 'repo-local', scope: 'project', client: 'kimi-code' });
      expect(mcp[0]!.source).toBe(join(projectDir, '.kimi-code', 'mcp.json'));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('does NOT find .kimi-code/mcp.json in a parent directory — Kimi does not walk upward for this file', async () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-noupward-'));
    try {
      mkdirSync(join(parentDir, '.kimi-code'), { recursive: true });
      writeFileSync(
        join(parentDir, '.kimi-code', 'mcp.json'),
        JSON.stringify({ mcpServers: { 'parent-only': { command: 'npx' } } }),
      );
      const childDir = join(parentDir, 'child');
      mkdirSync(childDir, { recursive: true });

      const result = await detectKimiCode({ cwd: childDir, scope: 'project' });
      // Unlike Codex/Cursor/Claude's project MCP detectors, this is a
      // literal cwd check — the parent's file is invisible from here.
      expect(result.tools.filter((t) => t.type === 'mcp')).toEqual([]);
      expect(result.pathsScanned).toContain(join(childDir, '.kimi-code', 'mcp.json'));
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it('$HOME guard: does not double-report ~/.kimi-code/mcp.json as project-scoped when cwd is $HOME', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-homeguard-'));
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'demo-search': { command: 'npx' } } }),
    );
    homedirHolder.current = tmpHome;

    const project = await detectKimiCode({ cwd: tmpHome, scope: 'project' });
    expect(project.tools).toEqual([]);
    expect(project.pathsScanned.filter((p) => p.endsWith(join('.kimi-code', 'mcp.json')))).toEqual([]);

    const user = await detectKimiCode({ scope: 'user' });
    expect(user.tools.map((t) => t.name)).toContain('demo-search');
    expect(user.tools.every((t) => t.scope === 'user')).toBe(true);
  });
});
