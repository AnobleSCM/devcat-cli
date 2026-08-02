import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { findUpward, isUserLevelPath } from '../lib/findUpward.js';
import { scanSkills, type RootTruncation } from './dirScan.js';
import type { ToolEntry } from './index.js';

interface CodexConfigToml {
  mcp_servers?: Record<string, unknown>;
}

interface SourceScan {
  tools: ToolEntry[];
  pathsScanned: string[];
  /** Roots where a scan bound bit. Absent means nothing was left out. */
  truncations?: RootTruncation[];
}

/**
 * Detect Codex tooling: MCP servers from config.toml, plus installed skills
 * under ~/.codex/skills (user scope only — Codex has no project skills root).
 *
 * Skills are frequently the same shelf Claude Code reads: both ~/.claude/skills
 * and ~/.codex/skills are usually link farms pointing at one shared directory.
 * Two dedupe passes handle that, and both are order-independent in effect:
 *
 *   - Within a root, scanSkills() collapses aliases by resolved path.
 *   - Across clients, dedupe() keys path-backed entries on (type, resolved
 *     path), keeping the first occurrence. detect() scans Claude Code before
 *     Codex, so a skill both shelves link to the same directory is listed
 *     once under Claude Code — deterministically, not by whichever filesystem
 *     answered first. Two same-named skills at DIFFERENT paths are different
 *     skills and both survive.
 */
export async function detectCodex(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  const mcp = await detectCodexMcp(opts);
  if (opts.scope !== 'user') return mcp;

  const skills = await readCodexSkillsDir(join(homedir(), '.codex', 'skills'));
  return {
    tools: [...mcp.tools, ...skills.tools],
    pathsScanned: [...mcp.pathsScanned, ...skills.pathsScanned],
    truncations: [...(mcp.truncations ?? []), ...(skills.truncations ?? [])],
  };
}

/**
 * Installed skills under a Codex `skills/` root. Report-only, like every
 * skill entry — never part of the /api/sync payload (see syncableTools).
 */
async function readCodexSkillsDir(path: string): Promise<SourceScan> {
  const { hits, truncation } = await scanSkills(path);
  const tools: ToolEntry[] = hits.map((hit) => ({
    type: 'skill' as const,
    name: hit.name,
    source: path,
    scope: 'user' as const,
    client: 'codex' as const,
    canonicalPath: hit.realPath,
  }));
  return { tools, pathsScanned: [path], truncations: truncation ? [truncation] : [] };
}

/**
 * Codex MCP servers from config.toml.
 *
 * User scope: reads ~/.codex/config.toml.
 * Project scope: walks CWD upward to find .codex/config.toml.
 *
 * Codex schema (verified via Codex source codex-rs/core/config.schema.json,
 * 2026-04-27): `[mcp_servers.<name>]` tables under root. Many optional fields
 * (command, args, env, url, cwd, enabled) — we extract only the table key as
 * the tool name (CLI-05 manifest-only-sync).
 */
async function detectCodexMcp(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  let path: string | null;
  let scannedPath: string;
  if (opts.scope === 'user') {
    path = join(homedir(), '.codex', 'config.toml');
    scannedPath = path;
  } else {
    if (!opts.cwd) return { tools: [], pathsScanned: [] };
    path = await findUpward(opts.cwd, '.codex', 'config.toml');
    // $HOME is an ancestor of most working directories; the user pass above
    // already reads that exact file, so don't relabel it project-scoped.
    if (path && (await isUserLevelPath(path, '.codex', 'config.toml'))) path = null;
    scannedPath = path ?? join(opts.cwd, '.codex', 'config.toml');
    if (!path) return { tools: [], pathsScanned: [scannedPath] };
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { tools: [], pathsScanned: [scannedPath] };
  }

  let parsed: CodexConfigToml;
  try {
    parsed = parseToml(raw) as CodexConfigToml;
  } catch {
    return { tools: [], pathsScanned: [scannedPath] };
  }

  const tools: ToolEntry[] = Object.keys(parsed.mcp_servers ?? {}).map((name) => ({
    type: 'mcp' as const,
    name,
    source: path!,
    scope: opts.scope,
    client: 'codex' as const,
  }));
  return { tools, pathsScanned: [scannedPath] };
}
