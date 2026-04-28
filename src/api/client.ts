import { buildUserAgent } from '../lib/userAgent.js';
import { debugLog } from '../lib/debugLog.js';

export interface FetchOpts extends RequestInit {
  bearerToken?: string;
}

/**
 * Wrapper over native fetch that:
 *   - Sets User-Agent on every request (Open Questions Q5)
 *   - Optionally sets Authorization: Bearer <token>
 *   - Sets Content-Type: application/json on POST/PUT/PATCH with body
 *   - Logs (redacted) request to stderr in --verbose mode
 *
 * Does NOT retry. Retry policy lives in callers (Phase 40 D-15: single
 * retry only on network-level failure).
 */
export async function authenticatedFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  headers.set('user-agent', buildUserAgent());
  if (opts.bearerToken) {
    headers.set('authorization', `Bearer ${opts.bearerToken}`);
  }
  if (opts.body && (opts.method === 'POST' || opts.method === 'PUT' || opts.method === 'PATCH')) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }

  const headerObj: Record<string, string> = {};
  headers.forEach((v, k) => { headerObj[k] = v; });
  debugLog(`HTTP ${opts.method ?? 'GET'} ${url}`, { headers: headerObj });

  // Strip the bearerToken extension before passing to native fetch.
  const fetchInit: RequestInit = { ...opts };
  delete (fetchInit as { bearerToken?: string }).bearerToken;
  fetchInit.headers = headers;

  const res = await fetch(url, fetchInit);
  debugLog(`HTTP ${res.status} ${url}`);
  return res;
}
