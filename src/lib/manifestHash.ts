import { createHash } from 'node:crypto';
import type { ToolType } from '../types/api.js';

/**
 * Phase 40 syncPayloadSchema requires `manifest_hash: SHA-256 hex` matching
 * the regex /^[a-f0-9]{64}$/. We compute it over a stable canonical form
 * of the tools array: sorted by (type, name), JSON-stringified with
 * ONLY (type, name) fields — strips manifest-layer extras (source, scope).
 *
 * Stable hash means a second sync with the same manifest produces the
 * same hash — useful for the server-side idempotency cache fingerprint
 * and for client-side regression tests.
 *
 * Accepts the structural superset { type, name, ... } so the manifest
 * detect()'s ToolEntry (which has source/scope) flows through cleanly.
 */
export function computeManifestHash(tools: ReadonlyArray<{ type: ToolType; name: string }>): string {
  const canonical = [...tools]
    .map((t) => ({ type: t.type, name: t.name }))
    .sort((a, b) => (a.type !== b.type ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name)));
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex');
}
