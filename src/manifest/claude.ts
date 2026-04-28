import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findUpward } from '../lib/findUpward.js';
import type { ToolEntry } from './index.js';

interface McpServersFile {
  mcpServers?: Record<string, unknown>;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, unknown>;
}

interface SourceScan {
  tools: ToolEntry[];
  pathsScanned: string[];
}

/**
 * Detect Claude Code MCP servers + installed plugins.
 *
 * Project scope (`opts.cwd` required): walks CWD upward to find `.mcp.json`.
 * User scope: reads ~/.claude.json, ~/.claude/settings.json, AND
 *             ~/.claude/plugins/installed_plugins.json. ~/.claude.json takes
 *             precedence over settings.json on key collision (Open Questions Q4).
 *
 * Plugin keys in installed_plugins.json are formatted "<name>@<marketplace>";
 * we extract the part before '@' as the plugin name (verified Example 3 in research).
 *
 * Forward-compat: installed_plugins.json with `version !== 2` is ignored entirely.
 */
export async function detectClaudeCode(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  if (opts.scope === 'project') {
    if (!opts.cwd) return { tools: [], pathsScanned: [] };
    return detectClaudeProjectScope(opts.cwd);
  }
  return detectClaudeUserScope();
}

async function detectClaudeProjectScope(cwd: string): Promise<SourceScan> {
  const path = await findUpward(cwd, '.mcp.json');
  if (!path) return { tools: [], pathsScanned: [join(cwd, '.mcp.json')] };
  return readMcpServersJson(path, 'project');
}

async function detectClaudeUserScope(): Promise<SourceScan> {
  const claudeJsonPath = join(homedir(), '.claude.json');
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const pluginsPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  const [claudeJson, settings, plugins] = await Promise.all([
    readMcpServersJson(claudeJsonPath, 'user'),
    readMcpServersJson(settingsPath, 'user'),
    readInstalledPluginsJson(pluginsPath),
  ]);

  // ~/.claude.json wins over ~/.claude/settings.json on name collision (Q4).
  const seen = new Set(claudeJson.tools.map((t) => t.name));
  const settingsFiltered = settings.tools.filter((t) => !seen.has(t.name));

  return {
    tools: [...claudeJson.tools, ...settingsFiltered, ...plugins.tools],
    pathsScanned: [...claudeJson.pathsScanned, ...settings.pathsScanned, ...plugins.pathsScanned],
  };
}

async function readMcpServersJson(path: string, scope: 'project' | 'user'): Promise<SourceScan> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { tools: [], pathsScanned: [path] };
  }
  let parsed: McpServersFile;
  try {
    parsed = JSON.parse(raw) as McpServersFile;
  } catch {
    return { tools: [], pathsScanned: [path] };
  }
  const tools: ToolEntry[] = Object.keys(parsed.mcpServers ?? {}).map((name) => ({
    type: 'mcp' as const,
    name,
    source: path,
    scope,
  }));
  return { tools, pathsScanned: [path] };
}

async function readInstalledPluginsJson(path: string): Promise<SourceScan> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { tools: [], pathsScanned: [path] };
  }
  let parsed: InstalledPluginsFile;
  try {
    parsed = JSON.parse(raw) as InstalledPluginsFile;
  } catch {
    return { tools: [], pathsScanned: [path] };
  }
  // Forward-compat guard: only read version 2.
  if (parsed.version !== 2) return { tools: [], pathsScanned: [path] };
  const tools: ToolEntry[] = Object.keys(parsed.plugins ?? {}).map((key) => ({
    type: 'plugin' as const,
    name: key.split('@')[0]!,
    source: path,
    scope: 'user' as const,
  }));
  return { tools, pathsScanned: [path] };
}
