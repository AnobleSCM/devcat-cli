import type { ToolEntry } from './index.js';

/**
 * Dedupe by (type, name) tuple. First occurrence wins.
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
    const key = `${e.type}::${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
