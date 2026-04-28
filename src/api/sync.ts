import { v7 as uuidv7 } from 'uuid';
import type { ToolType, SyncRequestBody, SyncResponseBody, ErrorEnvelope } from '../types/api.js';
import { authenticatedFetch } from './client.js';
import { getApiBase } from './types.js';
import { computeManifestHash } from '../lib/manifestHash.js';
import { emitEvent } from '../ui/jsonStream.js';

export class TokenInvalidError extends Error {
  public readonly envelope: ErrorEnvelope | null;
  constructor(envelope: ErrorEnvelope | null) {
    super('Access token rejected');
    this.name = 'TokenInvalidError';
    this.envelope = envelope;
  }
}

export class SyncFailedError extends Error {
  public readonly code: string;
  public readonly envelope: ErrorEnvelope | null;
  constructor(code: string, message: string, envelope: ErrorEnvelope | null) {
    super(message);
    this.name = 'SyncFailedError';
    this.code = code;
    this.envelope = envelope;
  }
}

export class NetworkFailedError extends Error {
  constructor(cause?: unknown) {
    super('Network failure on /api/sync');
    this.name = 'NetworkFailedError';
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

export interface PostSyncOpts {
  apiBase?: string;
  accessToken: string;
  /** Accepts the manifest layer's ToolEntry shape (structural superset of API ToolEntry). */
  tools: ReadonlyArray<{ type: ToolType; name: string }>;
}

/**
 * POST /api/sync. Phase 40 D-15 single retry on network-level failure.
 * Idempotency key (uuidv7) makes the retry safe.
 *
 * On 4xx/5xx: throw immediately. Caller maps the error code via errorMap.
 * On 401: throw TokenInvalidError so the caller can run D-16 refresh path.
 * On network-level failure (no HTTP response): retry exactly once with
 *   the same idempotency key. Second failure throws NetworkFailedError.
 */
export async function postSync(opts: PostSyncOpts): Promise<SyncResponseBody> {
  const apiBase = opts.apiBase ?? getApiBase();
  const idempotencyKey = uuidv7();
  const body: SyncRequestBody = {
    manifest_hash: computeManifestHash(opts.tools),
    tools: opts.tools.map((t) => ({ type: t.type, name: t.name })),
  };
  const bodyJson = JSON.stringify(body);

  emitEvent({ type: 'sync.start', tool_count: opts.tools.length, idempotency_key: idempotencyKey });

  // Attempt 1
  try {
    return await postSyncOnce(apiBase, opts.accessToken, idempotencyKey, bodyJson);
  } catch (err) {
    if (!(err instanceof NetworkFailedError)) throw err;
    // Retry exactly once with the same idempotency key (Phase 40 D-20)
  }

  // Attempt 2 (single retry)
  try {
    return await postSyncOnce(apiBase, opts.accessToken, idempotencyKey, bodyJson);
  } catch (err) {
    if (err instanceof NetworkFailedError) {
      emitEvent({ type: 'sync.error', code: 'network_failed' });
      throw err;
    }
    throw err;
  }
}

async function postSyncOnce(
  apiBase: string,
  accessToken: string,
  idempotencyKey: string,
  bodyJson: string,
): Promise<SyncResponseBody> {
  let res: Response;
  try {
    res = await authenticatedFetch(`${apiBase}/api/sync`, {
      method: 'POST',
      bearerToken: accessToken,
      headers: { 'x-sync-idempotency-key': idempotencyKey },
      body: bodyJson,
    });
  } catch (err) {
    // Native fetch throws TypeError on connection drop / DNS / TLS failure
    throw new NetworkFailedError(err);
  }

  if (res.status === 200) {
    return (await res.json()) as SyncResponseBody;
  }

  const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
  if (res.status === 401) {
    throw new TokenInvalidError(envelope);
  }
  const code = envelope?.code ?? `http_${res.status}`;
  const msg = envelope?.error ?? `Sync failed with HTTP ${res.status}.`;
  throw new SyncFailedError(code, msg, envelope);
}
