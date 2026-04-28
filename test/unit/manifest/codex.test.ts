import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCodex } from '../../../src/manifest/codex.js';

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

describe('detectCodex', () => {
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

  it('parses [mcp_servers.<name>] tables via smol-toml, emits ToolEntry with type=mcp', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-codex-userscope-'));
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.codex', 'config.toml'),
      '[mcp_servers.openai-tools]\n' +
      'command = "npx"\n' +
      'args = ["-y", "@openai/mcp-tools"]\n' +
      '\n' +
      '[mcp_servers.serena]\n' +
      'command = "uv"\n',
    );
    homedirHolder.current = tmpHome;
    const result = await detectCodex({ scope: 'user' });
    expect(result.tools).toHaveLength(2);
    expect(result.tools.find((t) => t.name === 'openai-tools')).toBeDefined();
    expect(result.tools.find((t) => t.name === 'serena')).toBeDefined();
    expect(result.tools.every((t) => t.type === 'mcp')).toBe(true);
    expect(result.tools.every((t) => t.scope === 'user')).toBe(true);
  });

  it('handles missing config.toml gracefully (returns empty, pathsScanned includes path)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-codex-missing-'));
    homedirHolder.current = tmpHome;
    const result = await detectCodex({ scope: 'user' });
    expect(result.tools).toEqual([]);
    expect(result.pathsScanned).toHaveLength(1);
    expect(result.pathsScanned[0]).toContain('.codex');
    expect(result.pathsScanned[0]).toContain('config.toml');
  });

  it('handles malformed TOML gracefully (returns empty)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-codex-bad-'));
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '][[invalid toml]\n');
    homedirHolder.current = tmpHome;
    const result = await detectCodex({ scope: 'user' });
    expect(result.tools).toEqual([]);
    expect(result.pathsScanned.length).toBe(1);
  });

  // W5 fix — CONTEXT D-06 per-project Codex config support
  it('detects project-scope codex config via CWD-upward walk', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'devcat-codex-proj-'));
    try {
      mkdirSync(join(projectDir, '.codex'), { recursive: true });
      writeFileSync(
        join(projectDir, '.codex', 'config.toml'),
        '[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n',
      );
      const result = await detectCodex({ cwd: projectDir, scope: 'project' });
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toMatchObject({
        type: 'mcp',
        name: 'context7',
        scope: 'project',
      });
      expect(result.tools[0]!.source).toContain('.codex');
      expect(result.tools[0]!.source).toContain('config.toml');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
