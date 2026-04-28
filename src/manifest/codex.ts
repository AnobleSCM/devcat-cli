import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { findUpward } from '../lib/findUpward.js';
import type { ToolEntry } from './index.js';

interface CodexConfigToml {
  mcp_servers?: Record<string, unknown>;
}

interface SourceScan {
  tools: ToolEntry[];
  pathsScanned: string[];
}

/**
 * Detect Codex MCP servers from config.toml.
 *
 * User scope: reads ~/.codex/config.toml.
 * Project scope: walks CWD upward to find .codex/config.toml.
 *
 * Codex schema (verified via Codex source codex-rs/core/config.schema.json,
 * 2026-04-27): `[mcp_servers.<name>]` tables under root. Many optional fields
 * (command, args, env, url, cwd, enabled) — we extract only the table key as
 * the tool name (CLI-05 manifest-only-sync).
 */
export async function detectCodex(opts: { cwd?: string; scope: 'project' | 'user' }): Promise<SourceScan> {
  let path: string | null;
  let scannedPath: string;
  if (opts.scope === 'user') {
    path = join(homedir(), '.codex', 'config.toml');
    scannedPath = path;
  } else {
    if (!opts.cwd) return { tools: [], pathsScanned: [] };
    path = await findUpward(opts.cwd, '.codex', 'config.toml');
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
  }));
  return { tools, pathsScanned: [scannedPath] };
}
