import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findUpward, findUpwardDir, isUserLevelPath } from '../lib/findUpward.js';
import { scanSkills, scanSubagents, type RootTruncation } from './dirScan.js';
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
  /** Roots where a scan bound bit. Absent means nothing was left out. */
  truncations?: RootTruncation[];
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
  const [mcpPath, skillsHit, agentsHit] = await Promise.all([
    findUpward(cwd, '.mcp.json'),
    findUpwardDir(cwd, '.claude', 'skills'),
    findUpwardDir(cwd, '.claude', 'agents'),
  ]);

  // The user-scope pass reads ~/.claude/skills and ~/.claude/agents directly,
  // so a walk that climbed all the way to $HOME is dropped here — otherwise
  // the whole user shelf would be reported as project-scoped.
  const skillsDir = skillsHit && !isUserLevelPath(skillsHit, '.claude', 'skills') ? skillsHit : null;
  const agentsDir = agentsHit && !isUserLevelPath(agentsHit, '.claude', 'agents') ? agentsHit : null;

  const [mcp, skills, subagents] = await Promise.all([
    mcpPath
      ? readMcpServersJson(mcpPath, 'project')
      : Promise.resolve({ tools: [], pathsScanned: [join(cwd, '.mcp.json')] }),
    readSkillsDir(skillsDir ?? join(cwd, '.claude', 'skills'), 'project'),
    readSubagentsDir(agentsDir ?? join(cwd, '.claude', 'agents'), 'project'),
  ]);

  return mergeScans([mcp, skills, subagents]);
}

async function detectClaudeUserScope(): Promise<SourceScan> {
  const claudeJsonPath = join(homedir(), '.claude.json');
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const pluginsPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const skillsPath = join(homedir(), '.claude', 'skills');
  const agentsPath = join(homedir(), '.claude', 'agents');

  const [claudeJson, settings, plugins, skills, subagents] = await Promise.all([
    readMcpServersJson(claudeJsonPath, 'user'),
    readMcpServersJson(settingsPath, 'user'),
    readInstalledPluginsJson(pluginsPath),
    readSkillsDir(skillsPath, 'user'),
    readSubagentsDir(agentsPath, 'user'),
  ]);

  // ~/.claude.json wins over ~/.claude/settings.json on name collision (Q4).
  const seen = new Set(claudeJson.tools.map((t) => t.name));
  const settingsFiltered = settings.tools.filter((t) => !seen.has(t.name));

  return mergeScans([
    { tools: claudeJson.tools, pathsScanned: claudeJson.pathsScanned },
    { tools: settingsFiltered, pathsScanned: settings.pathsScanned },
    plugins,
    skills,
    subagents,
  ]);
}

function mergeScans(scans: SourceScan[]): SourceScan {
  return {
    tools: scans.flatMap((s) => s.tools),
    pathsScanned: scans.flatMap((s) => s.pathsScanned),
    truncations: scans.flatMap((s) => s.truncations ?? []),
  };
}

/**
 * Installed skills under a `skills/` root. These are report-only detections —
 * they never enter the /api/sync payload (see syncableTools in index.ts).
 */
async function readSkillsDir(path: string, scope: 'project' | 'user'): Promise<SourceScan> {
  const { hits, truncation } = await scanSkills(path);
  const tools: ToolEntry[] = hits.map((hit) => ({
    type: 'skill' as const,
    name: hit.name,
    source: path,
    scope,
    client: 'claude-code' as const,
    canonicalPath: hit.realPath,
  }));
  return { tools, pathsScanned: [path], truncations: truncation ? [truncation] : [] };
}

/** Subagent personas under an `agents/` root. Report-only, as above. */
async function readSubagentsDir(path: string, scope: 'project' | 'user'): Promise<SourceScan> {
  const { hits, truncation } = await scanSubagents(path);
  const tools: ToolEntry[] = hits.map((hit) => ({
    type: 'subagent' as const,
    name: hit.name,
    source: path,
    scope,
    client: 'claude-code' as const,
    canonicalPath: hit.realPath,
  }));
  return { tools, pathsScanned: [path], truncations: truncation ? [truncation] : [] };
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
    client: 'claude-code' as const,
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
    client: 'claude-code' as const,
  }));
  return { tools, pathsScanned: [path] };
}
