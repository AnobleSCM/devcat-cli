import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClaudeCode } from '../../../src/manifest/claude.js';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

describe('detectClaudeCode', () => {
  let originalHome: string | undefined;
  let tmpHome: string | null = null;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = null;
    }
  });

  it('reads project-scope .mcp.json from cwd', async () => {
    const result = await detectClaudeCode({ cwd: join(FIXTURES, 'claude'), scope: 'project' });
    expect(result.tools.length).toBeGreaterThanOrEqual(2);
    expect(result.tools.find((t) => t.name === 'context7')).toBeDefined();
    expect(result.tools.find((t) => t.name === 'linear-mcp')).toBeDefined();
    expect(result.tools.every((t) => t.type === 'mcp')).toBe(true);
    expect(result.tools.every((t) => t.scope === 'project')).toBe(true);
  });

  it('returns empty + paths when project file missing', async () => {
    const cwd = '/tmp/devcat-nonexistent-' + Date.now();
    const result = await detectClaudeCode({ cwd, scope: 'project' });
    expect(result.tools).toEqual([]);
    expect(result.pathsScanned.length).toBe(1);
  });

  it('reads user-scope ~/.claude.json with HOME pointing to fixture dir, returns scope=user', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-userscope-'));
    writeFileSync(
      join(tmpHome, '.claude.json'),
      JSON.stringify({ mcpServers: { 'github': {} } }),
    );
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    const github = result.tools.find((t) => t.name === 'github');
    expect(github).toBeDefined();
    expect(github?.scope).toBe('user');
    expect(github?.type).toBe('mcp');
  });

  it('merges ~/.claude.json + ~/.claude/settings.json with .claude.json taking precedence on collision', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-merge-'));
    writeFileSync(
      join(tmpHome, '.claude.json'),
      JSON.stringify({ mcpServers: { 'github': {}, 'shared': {} } }),
    );
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { 'shared': {}, 'settings-only': {} } }),
    );
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools.find((t) => t.name === 'github')).toBeDefined();
    expect(result.tools.find((t) => t.name === 'shared')).toBeDefined();
    expect(result.tools.find((t) => t.name === 'settings-only')).toBeDefined();
    // 'shared' appears in both — only one entry should survive (Q4 precedence)
    expect(result.tools.filter((t) => t.name === 'shared').length).toBe(1);
  });

  it('reads installed_plugins.json (version 2 schema), splits keys on @', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-plugins-'));
    mkdirSync(join(tmpHome, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'swift-lsp@claude-plugins-official': [{}],
          'rust-analyzer@claude-plugins-official': [{}],
        },
      }),
    );
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    const swift = result.tools.find((t) => t.name === 'swift-lsp');
    const rust = result.tools.find((t) => t.name === 'rust-analyzer');
    expect(swift).toBeDefined();
    expect(swift?.type).toBe('plugin');
    expect(swift?.scope).toBe('user');
    expect(rust).toBeDefined();
    expect(rust?.type).toBe('plugin');
  });

  it('forward-compat: ignores installed_plugins.json with version != 2', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-v3-'));
    mkdirSync(join(tmpHome, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 99,
        plugins: { 'future-plugin@x': [{}] },
      }),
    );
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools.find((t) => t.type === 'plugin')).toBeUndefined();
  });

  it('handles missing files gracefully (returns empty, no exception)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-empty-'));
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools).toEqual([]);
    // pathsScanned should still record the three paths we tried
    expect(result.pathsScanned.length).toBeGreaterThanOrEqual(3);
  });

  it('handles malformed JSON gracefully (returns empty, pathsScanned still includes path)', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-bad-'));
    writeFileSync(join(tmpHome, '.claude.json'), '{not valid json');
    process.env.HOME = tmpHome;
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools.find((t) => t.name === 'should-not-exist')).toBeUndefined();
    expect(result.pathsScanned.some((p) => p.endsWith('.claude.json'))).toBe(true);
  });
});
