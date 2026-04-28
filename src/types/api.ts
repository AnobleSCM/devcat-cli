/**
 * Phase 40 API contract types — mirrored from vibe-code-playbook api/*.ts.
 *
 * NOT imported from vibe-code-playbook — devcat-cli is a separate repo.
 * If Phase 40's API evolves with breaking changes, the CLI bumps a major version.
 *
 * Source files (verified 2026-04-27):
 *   - api/device/request.ts (lines 122-134)
 *   - api/device/token.ts (lines 290-302)
 *   - api/device/refresh.ts (lines 137-148)
 *   - api/sync.ts (lines 78-96)
 *   - api/_lib/schemas.ts (zod schemas)
 *   - api/_lib/requestContext.ts (jsonError envelope)
 */

// ─────────────────────────── Tool & Manifest ──────────────────────────────

/** Tool type values accepted by /api/sync. Server rejects 'subagent' and 'agent'. */
export type ToolType = 'mcp' | 'skill' | 'plugin';

/** Single tool entry in the /api/sync request payload. */
export interface ToolEntry {
  type: ToolType;
  name: string;     // 1-128 chars; no control chars; no abs paths; no KEY=value
}

/** /api/sync request body. */
export interface SyncRequestBody {
  manifest_hash: string;        // SHA-256 hex (regex /^[a-f0-9]{64}$/)
  tools: ToolEntry[];           // max 500 entries
}

// ─────────────────────────── Device Flow ──────────────────────────────────

/** POST /api/device/request response (200). */
export interface DeviceCodeResponse {
  device_code: string;          // 64-char hex, raw — kept in memory only
  user_code: string;            // 'ABCD-EFGH' display form
  verification_uri: string;     // 'https://devcat.dev/device' (CLI must validate hostname)
  expires_in: number;           // 600 seconds
  interval: number;             // 5 seconds (CLI applies WSL safety multiplier)
}

/** POST /api/device/token request body. */
export interface TokenRequestBody {
  device_code: string;
  client_metadata: {
    cli_version: string;        // semver
    hostname: string;           // 1-64 chars (server re-sanitizes control chars)
    platform: 'darwin' | 'linux' | 'win32';
  };
}

/** POST /api/device/token success response (200). */
export interface TokenPair {
  access_token: string;         // ES256 JWT, scope 'cli-sync', 1h TTL
  refresh_token: string;        // ES256 JWT, scope 'cli-refresh', 24h TTL
  expires_in: number;           // 3600 (access_token TTL)
  token_type: 'Bearer';
}

/** POST /api/device/refresh request body. */
export interface RefreshRequestBody {
  refresh_token: string;
}

/** POST /api/device/refresh success response (200). NO new refresh_token. */
export interface RefreshResponse {
  access_token: string;
  expires_in: number;           // 3600
  token_type: 'Bearer';
}

// ─────────────────────────── Sync Response ────────────────────────────────

export type SyncStatus = 'exact_match' | 'fuzzy_match' | 'unmatched' | 'override_applied';

export interface SyncResultEntry {
  type: ToolType;
  name: string;
  status: SyncStatus;
  catalog_id: string | null;
  confidence?: number;          // present only when status === 'fuzzy_match'
}

export interface SyncCounts {
  exact: number;
  fuzzy: number;
  unmatched: number;
  override_applied?: number;
}

/** POST /api/sync success response (200). */
export interface SyncResponseBody {
  synced_at: string;
  session_id: string;
  results: SyncResultEntry[];
  counts: SyncCounts;
}

// ─────────────────────────── Error Envelope ───────────────────────────────

/**
 * Phase 40 stable error code enum (api/_lib/requestContext.ts uses these).
 * CLI maps each to a human message + exit code per Phase 39 CONTEXT D-17.
 */
export type ErrorCode =
  | 'method_not_allowed'
  | 'invalid_request'
  | 'invalid_json'
  | 'schema_violation'
  | 'unauthorized'
  | 'invalid_grant'
  | 'invalid_refresh_token'
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'code_consumed'
  | 'rate_limit_exceeded'
  | 'payload_too_large'
  | 'idempotency_conflict'
  | 'sync_disabled'
  | 'token_invalid'
  | 'internal_error';

/** Standard error envelope returned by all /api/* routes. */
export interface ErrorEnvelope {
  code: ErrorCode | string;     // string fallback — server may add codes
  error: string;
  requestId: string;
  retryAfterSeconds?: number;
  issues?: Array<{ path: string; code: string; message: string }>;
}
