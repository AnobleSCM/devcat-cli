import { detectClaudeCode } from './claude.js';
import { detectCodex } from './codex.js';
import { detectCursor } from './cursor.js';
import { dedupe } from './dedupe.js';

/** Which AI-coding tool a manifest entry was found in. */
export type ToolClient = 'claude-code' | 'codex' | 'cursor';

/**
 * A single tool surfaced from any local manifest.
 *
 * Only `type` and `name` are sent to /api/sync per CLI-05.
 * `source`, `scope`, and `client` are local-only metadata used for --json
 * terminal output, for the local stack report, and for ordering during the
 * project-first dedupe pass (D-08). `client` is always one of the fixed
 * literals above — never a value read out of a config file.
 */
export interface ToolEntry {
  type: 'mcp' | 'skill' | 'plugin' | 'subagent';
  name: string;
  source: string;
  scope: 'project' | 'user';
  client: ToolClient;
  /**
   * Symlink-resolved location, for detections that are a folder or file on
   * disk (skills, subagents). Absent for entries that are a key inside a
   * config file, which have no path of their own. When present it is the
   * dedupe identity — see dedupe().
   */
  canonicalPath?: string;
}

/**
 * The subset of detections that may enter the /api/sync payload: MCP servers
 * and plugins, the two things devcat.dev's catalog matches against.
 *
 * Skills and subagents are local report-only detections. They are folders on
 * this machine with no catalog entry behind them, and 'subagent' is not even
 * a type the server accepts — so they stay out of the payload entirely.
 * Narrowing here rather than filtering at the call site means handing an
 * unfiltered ToolEntry[] to postSync is a compile error, not a runtime bug.
 */
export type SyncableToolEntry = ToolEntry & { type: 'mcp' | 'plugin' };

export function syncableTools(tools: readonly ToolEntry[]): SyncableToolEntry[] {
  return tools.filter((t): t is SyncableToolEntry => t.type === 'mcp' || t.type === 'plugin');
}

export interface DetectResult {
  tools: ToolEntry[];
  pathsScanned: string[];
}

/**
 * Pure auto-detect (D-07). Scan order is project-scoped sources first,
 * then user-scoped — so project entries win on dedup collision (D-08).
 *
 * D-09 callers can read pathsScanned to print the friendly empty-state
 * enumeration: "No AI tools detected. Looked in: …".
 */
export async function detect(cwd: string): Promise<DetectResult> {
  const sources = await Promise.all([
    // PROJECT FIRST — closer to the user's intent.
    detectClaudeCode({ cwd, scope: 'project' }),
    detectCodex({ cwd, scope: 'project' }),
    detectCursor({ cwd, scope: 'project' }),
    // USER SECOND.
    detectClaudeCode({ scope: 'user' }),
    detectCodex({ scope: 'user' }),
    detectCursor({ scope: 'user' }),
  ]);
  const allTools = sources.flatMap((s) => s.tools);
  const allPaths = sources.flatMap((s) => s.pathsScanned);
  return {
    tools: dedupe(allTools),
    pathsScanned: allPaths,
  };
}
