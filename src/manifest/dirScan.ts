import { opendir, realpath, stat } from 'node:fs/promises';
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
 *   - Two hard bounds, so a pathological root can neither hang the CLI nor
 *     quietly change what gets reported:
 *       READ_CEILING limits how many entries are ever pulled out of one
 *       directory — the iteration stops there, it does not read the rest.
 *       MAX_ENTRIES_EXAMINED limits how many of those get the expensive
 *       per-entry stat/realpath work, applied AFTER sorting so the kept
 *       subset is the same on every run.
 *   - Whenever either bound bites, the scan says so. Silently dropping a
 *     valid tool while every output claims completeness is the failure this
 *     reporting exists to prevent.
 *
 * Names come from the directory (or file) name, which is how skills and
 * subagents are actually addressed — no file contents are read.
 */

/**
 * Hard upper bound on entries pulled from a single directory. Reached only by
 * a root that is not a real config directory; the shelves this scans hold
 * dozens. Streaming via opendir means the remainder is never read at all.
 */
export const READ_CEILING = 10_000;

/** Entries that get the per-entry filesystem work, after deterministic sort. */
export const MAX_ENTRIES_EXAMINED = 500;

export interface DirHit {
  name: string;
  /** Symlink-resolved absolute path. Dedupes link-farm aliases. */
  realPath: string;
}

/** Emitted when a bound bit, so every output layer can disclose it. */
export interface RootTruncation {
  root: string;
  /** Candidate names actually read from the directory. */
  entriesSeen: number;
  /** Of those, how many were examined (the rest were dropped by the cap). */
  entriesKept: number;
  /** True when reading stopped at READ_CEILING — more names exist, unread. */
  hitReadCeiling: boolean;
}

export interface DirScanResult {
  hits: DirHit[];
  /** Null when the whole root was read and examined. */
  truncation: RootTruncation | null;
}

/**
 * Skills: an immediate child directory of `root` containing SKILL.md.
 *
 * Depth 1. Non-skill clutter that shares the directory (`.git`, `AGENTS.md`,
 * a README) is ignored by the SKILL.md requirement.
 *
 * `readCeiling` exists so tests can reach the ceiling path without creating
 * ten thousand directories. Production always uses the default.
 */
export async function scanSkills(root: string, readCeiling = READ_CEILING): Promise<DirScanResult> {
  return scanRoot(root, readCeiling, async (entryPath, name) => {
    const resolved = await resolveDir(entryPath);
    if (!resolved) return null;
    if (!(await isFile(join(resolved, 'SKILL.md')))) return null;
    return { name, realPath: resolved };
  });
}

/**
 * Subagents: both shapes Claude Code accepts —
 *   <root>/<name>.md          (a bare persona file)
 *   <root>/<name>/<name>.md   (a persona folder, matching name required)
 *
 * The folder shape is matched exactly: `reviewer/` counts only if it holds
 * `reviewer.md`. A folder holding some other markdown — a README, notes — is
 * not a persona and is skipped. That exactness also means the second level
 * costs one stat for a known filename rather than a directory listing, so
 * nothing here reads an unbounded number of entries.
 */
export async function scanSubagents(
  root: string,
  readCeiling = READ_CEILING,
): Promise<DirScanResult> {
  return scanRoot(root, readCeiling, async (entryPath, name) => {
    if (name.toLowerCase().endsWith('.md')) {
      if (!(await isFile(entryPath))) return null;
      const resolved = await realpathOrNull(entryPath);
      if (!resolved) return null;
      return { name: name.slice(0, -'.md'.length), realPath: resolved };
    }
    const resolved = await resolveDir(entryPath);
    if (!resolved) return null;
    if (!(await isFile(join(resolved, `${name}.md`)))) return null;
    return { name, realPath: resolved };
  });
}

/**
 * Read up to READ_CEILING candidate names out of `root`, streaming.
 *
 * opendir yields entries lazily, so hitting the ceiling means the remainder
 * of a pathological directory is never read — the bound is on the work done,
 * not just on the result. Dot-entries are skipped but still count toward the
 * ceiling, so a directory full of them cannot spin forever either.
 *
 * Returns null when the root cannot be opened at all (missing, or no
 * permission) — indistinguishable outcomes, both meaning "nothing here".
 */
async function readCandidateNames(
  root: string,
  readCeiling: number,
): Promise<{ names: string[]; hitReadCeiling: boolean } | null> {
  let dir;
  try {
    dir = await opendir(root);
  } catch {
    return null;
  }

  const names: string[] = [];
  let iterated = 0;
  let hitReadCeiling = false;
  try {
    for await (const entry of dir) {
      if (iterated >= readCeiling) {
        hitReadCeiling = true;
        break;
      }
      iterated += 1;
      if (entry.name.startsWith('.')) continue;
      names.push(entry.name);
    }
  } catch {
    // A directory that vanishes or errors mid-iteration still yields whatever
    // was read. The async iterator closes the handle on the way out.
  }
  return { names, hitReadCeiling };
}

/**
 * Shared shape: read a root's immediate children under both bounds, classify
 * each with `classify`, drop the misses, dedupe on resolved path, and report
 * whether anything was left out.
 */
async function scanRoot(
  root: string,
  readCeiling: number,
  classify: (entryPath: string, name: string) => Promise<DirHit | null>,
): Promise<DirScanResult> {
  const read = await readCandidateNames(root, readCeiling);
  if (!read) return { hits: [], truncation: null };

  // Sort before capping so the examined subset is the same on every run,
  // whatever order the filesystem returned.
  const sorted = [...read.names].sort((a, b) => a.localeCompare(b));
  const candidates = sorted.slice(0, MAX_ENTRIES_EXAMINED);

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

  const droppedByCap = sorted.length > candidates.length;
  const truncation: RootTruncation | null =
    droppedByCap || read.hitReadCeiling
      ? {
          root,
          entriesSeen: sorted.length,
          entriesKept: candidates.length,
          hitReadCeiling: read.hitReadCeiling,
        }
      : null;

  return { hits, truncation };
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
