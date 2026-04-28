import { detectClaudeCode } from './claude.js';
import { detectCodex } from './codex.js';
import { detectCursor } from './cursor.js';
import { dedupe } from './dedupe.js';

/**
 * A single tool surfaced from any local manifest.
 *
 * Only `type` and `name` are sent to /api/sync per CLI-05.
 * `source` and `scope` are local-only metadata used for --json terminal output
 * and for ordering during the project-first dedupe pass (D-08).
 */
export interface ToolEntry {
  type: 'mcp' | 'skill' | 'plugin';
  name: string;
  source: string;
  scope: 'project' | 'user';
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
