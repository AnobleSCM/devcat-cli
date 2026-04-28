import { authenticatedFetch } from '../api/client.js';
import { getApiBase } from '../api/types.js';
import type { RefreshResponse, ErrorEnvelope, RefreshRequestBody } from '../types/api.js';
import { emitEvent } from '../ui/jsonStream.js';

/**
 * Refresh-token client. Phase 40 D-03 hard-caps refresh-token at 24h.
 * On 401 invalid_refresh_token, the caller (Plan 39-04 sync command)
 * wipes keychain and re-triggers device flow inline (CONTEXT D-16).
 *
 * Phase 40 mints access-only on refresh — we do NOT receive a new
 * refresh_token here.
 */
export class RefreshTokenInvalidError extends Error {
  constructor() {
    super('Refresh token is invalid or revoked.');
    this.name = 'RefreshTokenInvalidError';
  }
}

export async function refreshAccessToken(opts: {
  apiBase?: string;
  refreshToken: string;
}): Promise<RefreshResponse> {
  const apiBase = opts.apiBase ?? getApiBase();
  const body: RefreshRequestBody = { refresh_token: opts.refreshToken };
  const res = await authenticatedFetch(`${apiBase}/api/device/refresh`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.status === 200) {
    emitEvent({ type: 'auth.refresh' });
    return (await res.json()) as RefreshResponse;
  }
  if (res.status === 401) {
    emitEvent({ type: 'auth.refresh.failed', code: 'invalid_refresh_token' });
    throw new RefreshTokenInvalidError();
  }
  const env = (await res.json().catch(() => ({}))) as Partial<ErrorEnvelope>;
  throw new Error(env.error ?? `Refresh failed (HTTP ${res.status}).`);
}
