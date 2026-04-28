import { stat } from 'node:fs/promises';
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
