import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';

/**
 * Walk from `start` upward toward the filesystem root, looking for
 * `relativePathSegments` (e.g. ['.mcp.json'] or ['.cursor', 'mcp.json']).
 *
 * Returns the absolute path of the first match, or null. Stops at the
 * filesystem root — never escapes the user's home or follows symlinks.
 *
 * Bounded at 64 iterations as a defensive guard against pathological
 * filesystem layouts; real-world project depth is rarely > 10 levels.
 */
export async function findUpward(start: string, ...relativePathSegments: string[]): Promise<string | null> {
  const root = parse(start).root;
  let current = start;
  for (let i = 0; i < 64; i++) {
    const candidate = join(current, ...relativePathSegments);
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      // not found at this level; keep walking upward
    }
    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * True when an upward walk landed on the user-level config path itself.
 *
 * $HOME is an ancestor of most working directories, so a walk started in
 * ~/Developer/some-repo happily "finds" ~/.codex/config.toml and would label
 * it project-scoped. Callers whose user-scope pass already reads that exact
 * path use this to skip the hit rather than mislabel it — nothing is lost,
 * the same tools are still detected, with the right scope.
 *
 * Only for paths that HAVE a user-scope reader. `.mcp.json` has none, so
 * ~/.mcp.json is still legitimately picked up by the project walk.
 */
export function isUserLevelPath(found: string, ...relativePathSegments: string[]): boolean {
  return found === join(homedir(), ...relativePathSegments);
}

/**
 * Directory-matching twin of findUpward, for config that is a folder rather
 * than a file (`.claude/skills/`, `.claude/agents/`). Same bounds and same
 * stop-at-root behaviour; kept separate so findUpward's callers are untouched.
 */
export async function findUpwardDir(start: string, ...relativePathSegments: string[]): Promise<string | null> {
  const root = parse(start).root;
  let current = start;
  for (let i = 0; i < 64; i++) {
    const candidate = join(current, ...relativePathSegments);
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      // not found at this level; keep walking upward
    }
    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
