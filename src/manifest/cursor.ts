import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findUpward, isUserLevelPath } from '../lib/findUpward.js';
import type { ToolEntry } from './index.js';

interface CursorMcpFile {
  mcpServers?: Record<string, unknown>;
}

interface SourceScan {
  tools: ToolEntry[];
  pathsScanned: string[];
  /** Cursor has no directory-shaped detections, so this is always absent. */
  truncations?: never[];
}

/**
 * Detect Cursor MCP servers from mcp.json.
 *
 * User scope: reads ~/.cursor/mcp.json.
 * Project scope: walks CWD upward to find .cursor/mcp.json.
 *
 * Cursor's schema is identical to Claude Code's `.mcp.json` shape
 * (verified cursor.com/docs/context/mcp 2026-04-27): top-level
 * `mcpServers: Record<name, { command?, args?, env?, url? }>`.
 * We extract only the top-level keys as MCP server names.
 */
export async function detectCursor(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  let path: string | null;
  let scannedPath: string;
  if (opts.scope === 'user') {
    path = join(homedir(), '.cursor', 'mcp.json');
    scannedPath = path;
  } else {
    if (!opts.cwd) return { tools: [], pathsScanned: [] };
    path = await findUpward(opts.cwd, '.cursor', 'mcp.json');
    // Same guard as the Codex detector, candidate and all: run from $HOME,
    // the fallback IS the user file, so the project pass reports nothing
    // rather than duplicating a location the user pass already names.
    const candidate = path ?? join(opts.cwd, '.cursor', 'mcp.json');
    if (await isUserLevelPath(candidate, '.cursor', 'mcp.json')) {
      return { tools: [], pathsScanned: [] };
    }
    scannedPath = candidate;
    if (!path) return { tools: [], pathsScanned: [scannedPath] };
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { tools: [], pathsScanned: [scannedPath] };
  }

  let parsed: CursorMcpFile;
  try {
    parsed = JSON.parse(raw) as CursorMcpFile;
  } catch {
    return { tools: [], pathsScanned: [scannedPath] };
  }

  const tools: ToolEntry[] = Object.keys(parsed.mcpServers ?? {}).map((name) => ({
    type: 'mcp' as const,
    name,
    source: path!,
    scope: opts.scope,
    client: 'cursor' as const,
  }));
  return { tools, pathsScanned: [scannedPath] };
}
