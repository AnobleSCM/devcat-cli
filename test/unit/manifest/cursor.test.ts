import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCursor } from '../../../src/manifest/cursor.js';

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

describe('detectCursor', () => {
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

  it('reads ~/.cursor/mcp.json, emits ToolEntry with type=mcp and scope=user', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-cursor-userscope-'));
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'supabase': {}, 'cloudflare': {} } }),
    );
    homedirHolder.current = tmpHome;
    const result = await detectCursor({ scope: 'user' });
    expect(result.tools).toHaveLength(2);
    expect(result.tools.find((t) => t.name === 'supabase')).toBeDefined();
    expect(result.tools.find((t) => t.name === 'cloudflare')).toBeDefined();
    expect(result.tools.every((t) => t.type === 'mcp')).toBe(true);
    expect(result.tools.every((t) => t.scope === 'user')).toBe(true);
  });

  it('reads project-scope .cursor/mcp.json from cwd, scope=project', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'devcat-cursor-proj-'));
    try {
      mkdirSync(join(projectDir, '.cursor'), { recursive: true });
      writeFileSync(
        join(projectDir, '.cursor', 'mcp.json'),
        JSON.stringify({ mcpServers: { 'project-mcp': {} } }),
      );
      const result = await detectCursor({ cwd: projectDir, scope: 'project' });
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toMatchObject({
        type: 'mcp',
        name: 'project-mcp',
        scope: 'project',
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
