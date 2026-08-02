import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Directory-shaped detections: skills and subagents are folders on disk, not
 * keys in a config file, so they need a bounded directory scan rather than a
 * JSON/TOML parse.
 *
 * Every scan here is deliberately shallow and deliberately incurious:
 *
 *   - It only ever reads a root it was handed (a known config location) and
 *     that root's immediate children. It never recurses, so it cannot wander
 *     out of the config root by following a symlink into a large tree.
 *   - Symlinks are resolved with realpath() to a single canonical path — the
 *     `~/.claude/skills` link farm is entirely symlinks — and the resolved
 *     path is what deduplicates aliases pointing at the same skill.
 *   - A broken symlink, an unreadable directory, or a vanished entry is
 *     skipped. A machine with a stale link never fails a scan.
 *   - Entry count per root is capped so a pathological directory cannot make
 *     the CLI hang.
 *
 * Names come from the directory (or file) name, which is how skills and
 * subagents are actually addressed — no file contents are read.
 */

/** Defensive bound, in the spirit of findUpward's 64-level cap. */
const MAX_ENTRIES_PER_ROOT = 500;

export interface DirHit {
  name: string;
  /** Symlink-resolved absolute path. Dedupes link-farm aliases. */
  realPath: string;
}

/**
 * Skills: an immediate child directory of `root` containing SKILL.md.
 *
 * Depth 1. Non-skill clutter that shares the directory (`.git`, `AGENTS.md`,
 * a README) is ignored by the SKILL.md requirement.
 */
export async function scanSkills(root: string): Promise<DirHit[]> {
  return scanRoot(root, async (entryPath, name) => {
    const resolved = await resolveDir(entryPath);
    if (!resolved) return null;
    if (!(await isFile(join(resolved, 'SKILL.md')))) return null;
    return { name, realPath: resolved };
  });
}

/**
 * Subagents: both shapes Claude Code accepts —
 *   <root>/<name>.md          (a bare persona file)
 *   <root>/<name>/<name>.md   (a persona folder)
 *
 * Depth 2 at the most, and the second level is read only far enough to
 * confirm the folder holds at least one .md.
 */
export async function scanSubagents(root: string): Promise<DirHit[]> {
  return scanRoot(root, async (entryPath, name) => {
    if (name.toLowerCase().endsWith('.md')) {
      if (!(await isFile(entryPath))) return null;
      const resolved = await realpathOrNull(entryPath);
      if (!resolved) return null;
      return { name: name.slice(0, -'.md'.length), realPath: resolved };
    }
    const resolved = await resolveDir(entryPath);
    if (!resolved) return null;
    if (!(await containsMarkdown(resolved))) return null;
    return { name, realPath: resolved };
  });
}

/**
 * Shared shape: list a root's immediate children, classify each with
 * `classify`, drop the misses, and dedupe on resolved path.
 */
async function scanRoot(
  root: string,
  classify: (entryPath: string, name: string) => Promise<DirHit | null>,
): Promise<DirHit[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    // Missing root, or no permission to read it. Either way: nothing here.
    return [];
  }

  const candidates = names
    .filter((name) => !name.startsWith('.'))
    .slice(0, MAX_ENTRIES_PER_ROOT)
    .sort((a, b) => a.localeCompare(b));

  const settled = await Promise.all(
    candidates.map(async (name) => {
      try {
        return await classify(join(root, name), name);
      } catch {
        return null;
      }
    }),
  );

  const seen = new Set<string>();
  const hits: DirHit[] = [];
  for (const hit of settled) {
    if (!hit) continue;
    if (seen.has(hit.realPath)) continue;
    seen.add(hit.realPath);
    hits.push(hit);
  }
  return hits;
}

/** Resolve `path` to a real directory, or null if it is not one / is broken. */
async function resolveDir(path: string): Promise<string | null> {
  const resolved = await realpathOrNull(path);
  if (!resolved) return null;
  try {
    const s = await stat(resolved);
    return s.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    // Broken symlink, or removed between readdir and here.
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function containsMarkdown(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir);
    return names.some((n) => !n.startsWith('.') && n.toLowerCase().endsWith('.md'));
  } catch {
    return false;
  }
}
