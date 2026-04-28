/**
 * Redaction-aware debug logger.
 *
 * Mirrors Stripe CLI's verbosetransport.go regex pattern verbatim
 * (research Pattern 5; Pitfall 2 mitigation). All --verbose and
 * --json HTTP-trace output flows through redactHeaders + redactBody.
 *
 * NEVER write Authorization headers or token values to stdout/stderr
 * directly anywhere in this codebase. Always go through debugLog().
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-sync-idempotency-key',
]);

/**
 * Match keys whose VALUE may be a credential. We test the KEY, then
 * replace the value with [REDACTED] regardless of value content.
 */
const SENSITIVE_BODY_KEY_PATTERN = /^(access_token|refresh_token|device_code|user_code|password|.*_secret|.*_token)$/i;

/** Stripe CLI's pattern verbatim — see verbosetransport.go:65 */
const BEARER_PATTERN = /^(basic|bearer)\s+(.+)$/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      out[name] = redactBearer(value);
    } else {
      out[name] = value;
    }
  }
  return out;
}

function redactBearer(value: string): string {
  const m = BEARER_PATTERN.exec(value);
  return m ? `${m[1]} [REDACTED]` : '[REDACTED]';
}

export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined) return body;
  if (typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(redactBody);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE_BODY_KEY_PATTERN.test(k) ? '[REDACTED]' : redactBody(v);
  }
  return out;
}

/**
 * Emit a debug line to stderr if --verbose / -v is set OR DEVCAT_DEBUG env
 * var is set. Always redacts. Never writes to stdout (stdout is reserved
 * for human copy and --json events).
 */
export function debugLog(msg: string, meta?: { headers?: Record<string, string>; body?: unknown }): void {
  const verboseFlag =
    process.argv.includes('--verbose') || process.argv.includes('-v') || process.env.DEVCAT_DEBUG;
  if (!verboseFlag) return;
  const safe = {
    headers: meta?.headers ? redactHeaders(meta.headers) : undefined,
    body: meta?.body !== undefined ? redactBody(meta.body) : undefined,
  };
  const line = meta ? `${msg}\n${JSON.stringify(safe)}` : msg;
  process.stderr.write(`${line}\n`);
}
