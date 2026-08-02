import type { ToolEntry } from './index.js';

/**
 * Dedupe by identity. First occurrence wins.
 *
 * Two identities, because the entries have two natures:
 *
 *   - An entry with a canonicalPath IS a thing on disk. Two entries resolving
 *     to the same path are the same skill however they are named, and two
 *     entries at different paths are different skills however similarly they
 *     are named. `~/.claude/skills` and `~/.codex/skills` are usually link
 *     farms into one shared directory, so path identity is what actually
 *     collapses that overlap — and it is what stops two genuinely different
 *     skills that happen to share a name from swallowing each other.
 *   - An entry without one is a key inside a config file, where (type, name)
 *     is the only identity available. That is also what the server matches on.
 *
 * The two key spaces are prefixed so a path can never collide with a name.
 *
 * Caller orders the input array project-first so project-local entries win
 * over user-scoped duplicates per Phase 39 CONTEXT D-08.
 *
 * Case-sensitive on name — exact match runs server-side first
 * (api/_lib/matchTools.ts), so we preserve the user-typed casing.
 */
export function dedupe(entries: ToolEntry[]): ToolEntry[] {
  const seen = new Set<string>();
  const out: ToolEntry[] = [];
  for (const e of entries) {
    const key = e.canonicalPath
      ? `path::${e.canonicalPath}`
      : `name::${e.type}::${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
