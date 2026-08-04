import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findUpwardDir, isUserLevelPath } from '../lib/findUpward.js';
import { scanSkills, type RootTruncation } from './dirScan.js';
import type { ToolEntry } from './index.js';

interface McpServersFile {
  mcpServers?: Record<string, unknown>;
}

interface SourceScan {
  tools: ToolEntry[];
  pathsScanned: string[];
  /** Roots where a scan bound bit. Absent means nothing was left out. */
  truncations?: RootTruncation[];
}

/**
 * Detect Kimi Code tooling: MCP servers from mcp.json, plus skills on
 * Kimi's own discovery roots.
 *
 * Kimi Code's MCP config is JSON, not TOML, and does not live in
 * config.toml at all — verified against the installed CLI's own bundled
 * `import-from-cc-codex` skill source and its MCP path resolver (kimi
 * 0.31.1, 2026-08-03). Three files, all `{ mcpServers: { <name>: {...} } }`,
 * same shape as Claude Code's:
 *
 *   - user-global:   ~/.kimi-code/mcp.json (or $KIMI_CODE_HOME/mcp.json)
 *   - project-root:  <nearest .git ancestor>/.mcp.json — the SAME file
 *     Claude Code's project detector already reads. Not re-scanned here:
 *     Claude Code is scanned before Kimi Code in detect(), so a second
 *     read of this file would only ever dedupe away on the (type, name)
 *     key, and modeling Kimi's git-root walk with a second algorithm just
 *     to produce entries that never survive dedupe isn't worth the surface.
 *   - project-local: <cwd literally>/.kimi-code/mcp.json — read from the
 *     exact working directory, NOT an upward walk. Confirmed in the
 *     bundled skill source: "Kimi reads the current working directory's
 *     Kimi-specific MCP file, not every project-root .kimi-code/mcp.json
 *     from subdirectories."
 *
 * Skills: Kimi auto-discovers two roots at both scopes (verified via the
 * PROJECT_BRAND_DIRS / PROJECT_GENERIC_DIRS / USER_BRAND_DIRS /
 * USER_GENERIC_DIRS constants embedded in the installed CLI binary):
 *
 *   - brand:   .kimi-code/skills  (user: ~/.kimi-code/skills)
 *   - generic: .agents/skills     (user: ~/.agents/skills — the same
 *     shared shelf Claude Code and Codex already reach through their own
 *     link farms)
 *
 * Kimi resolves its project skill roots via its own project-root walk
 * (nearest .git ancestor, confirmed in the same binary). Approximated here
 * with findUpwardDir — the same upward-search Claude Code's project
 * skills/agents roots already use, so this is an existing simplification,
 * not a new one.
 *
 * Not scanned: Kimi's `.agents/agents` / `.kimi-code/agents` subagent
 * roots. They are real and auto-discovered (confirmed in the same binary
 * strings as the skill roots above), but subagent detection is outside
 * this mission's scope (MCP servers + skills only) — left for a follow-up.
 *
 * Three dedupe layers now apply to the shared shelf, same as Codex:
 *
 *   - Within a root, scanSkills() collapses aliases by resolved path.
 *   - Across clients, dedupe() keys path-backed entries on (type, resolved
 *     path). detect() scans Claude Code, then Codex, then Kimi Code, so a
 *     skill all three shelves link to is listed once under Claude Code —
 *     deterministically, not by whichever filesystem answered first.
 *
 * Install-marker gate: `.agents/skills` is not Kimi's own directory — it is
 * the shared global install target skills.sh (vercel-labs) uses for several
 * NON-Kimi tools (Cline, Warp, Zed, Dexto, Loaf). Its mere presence proves
 * nothing about Kimi, so this whole detector runs only when Kimi's own
 * config directory exists: `~/.kimi-code` at user scope, `<cwd>/.kimi-code`
 * at project scope, checked independently (a project-only marker still
 * runs the project pass with the user pass gated closed, and vice versa).
 * A missing marker means zero contribution — no tools, and no paths added
 * to pathsScanned, because nothing was actually checked.
 */
export async function detectKimiCode(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  if (!(await kimiInstalled(opts))) return { tools: [], pathsScanned: [] };
  const [mcp, skills] = await Promise.all([detectKimiMcp(opts), detectKimiSkills(opts)]);
  return mergeScans([mcp, skills]);
}

/** Pure existence check — no file is read, matching this scanner's names-only philosophy. */
async function kimiInstalled(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<boolean> {
  if (opts.scope === 'user') return dirExists(join(homedir(), '.kimi-code'));
  return opts.cwd != null && (await dirExists(join(opts.cwd, '.kimi-code')));
}

/**
 * True only when `path` is a directory — a stray file named `.kimi-code`
 * must not open the gate. `stat` (not `lstat`) follows symlinks, so a
 * symlink to a real directory still passes; that's the one stat() call
 * this already needed, so the directory check costs nothing extra.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Kimi Code MCP servers.
 *
 * User scope: reads ~/.kimi-code/mcp.json.
 * Project scope: reads `<cwd>/.kimi-code/mcp.json` literally — no upward
 * walk (see module doc). Guarded the same way an upward walk would be:
 * run from $HOME, this candidate IS the user-global file, and the user
 * pass above already names it, so it is skipped here rather than
 * double-reported as project-scoped.
 */
async function detectKimiMcp(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  if (opts.scope === 'user') {
    return readMcpServersJson(join(homedir(), '.kimi-code', 'mcp.json'), 'user');
  }
  if (!opts.cwd) return { tools: [], pathsScanned: [] };
  const path = join(opts.cwd, '.kimi-code', 'mcp.json');
  if (await isUserLevelPath(path, '.kimi-code', 'mcp.json')) {
    return { tools: [], pathsScanned: [] };
  }
  return readMcpServersJson(path, 'project');
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
    client: 'kimi-code' as const,
  }));
  return { tools, pathsScanned: [path] };
}

/** Kimi Code skills: the brand root and the shared generic root, both scopes. */
async function detectKimiSkills(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  if (opts.scope === 'user') {
    const [brand, generic] = await Promise.all([
      readSkillsDir(join(homedir(), '.kimi-code', 'skills'), 'user'),
      readSkillsDir(join(homedir(), '.agents', 'skills'), 'user'),
    ]);
    return mergeScans([brand, generic]);
  }

  if (!opts.cwd) return { tools: [], pathsScanned: [] };
  const [brandDir, genericDir] = await Promise.all([
    projectDirToScan(opts.cwd, '.kimi-code', 'skills'),
    projectDirToScan(opts.cwd, '.agents', 'skills'),
  ]);
  const [brand, generic] = await Promise.all([
    scanProjectDir(brandDir, readSkillsDir),
    scanProjectDir(genericDir, readSkillsDir),
  ]);
  return mergeScans([brand, generic]);
}

/**
 * Decide what the project pass may scan for a directory-shaped location.
 *
 * Returns the directory to scan, or a report-only path when there is
 * nothing legitimate to scan there — the caller still names it among the
 * locations checked, unless it is the user root, which the user pass
 * already reports. Mirrors claude.ts's projectDirToScan: same guard, same
 * reasoning (findUpwardDir approximates Kimi's real git-root project
 * resolution, and a walk landing on $HOME must not double-count the user
 * shelf as project-scoped).
 */
async function projectDirToScan(
  cwd: string,
  ...segments: string[]
): Promise<{ scan: string | null; report: string | null }> {
  const hit = await findUpwardDir(cwd, ...segments);
  const candidate = hit ?? join(cwd, ...segments);
  if (await isUserLevelPath(candidate, ...segments)) {
    return { scan: null, report: null };
  }
  return { scan: hit, report: candidate };
}

/** Run a directory reader, or produce a report-only scan when it must be skipped. */
async function scanProjectDir(
  target: { scan: string | null; report: string | null },
  read: (path: string, scope: 'project' | 'user') => Promise<SourceScan>,
): Promise<SourceScan> {
  if (target.scan) return read(target.scan, 'project');
  return { tools: [], pathsScanned: target.report ? [target.report] : [] };
}

/**
 * Installed skills under a Kimi Code `skills/` root. Report-only, like
 * every skill entry — never part of the /api/sync payload (see
 * syncableTools).
 */
async function readSkillsDir(path: string, scope: 'project' | 'user'): Promise<SourceScan> {
  const { hits, truncation } = await scanSkills(path);
  const tools: ToolEntry[] = hits.map((hit) => ({
    type: 'skill' as const,
    name: hit.name,
    source: path,
    scope,
    client: 'kimi-code' as const,
    canonicalPath: hit.realPath,
  }));
  return { tools, pathsScanned: [path], truncations: truncation ? [truncation] : [] };
}

function mergeScans(scans: SourceScan[]): SourceScan {
  return {
    tools: scans.flatMap((s) => s.tools),
    pathsScanned: scans.flatMap((s) => s.pathsScanned),
    truncations: scans.flatMap((s) => s.truncations ?? []),
  };
}
