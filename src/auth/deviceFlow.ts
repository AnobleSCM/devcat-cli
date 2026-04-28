import * as os from 'node:os';
import { CLI_VERSION } from '../version.js';
import type {
  DeviceCodeResponse,
  TokenPair,
  ErrorEnvelope,
  TokenRequestBody,
} from '../types/api.js';
import { authenticatedFetch } from '../api/client.js';
import { getApiBase } from '../api/types.js';
import { emitEvent } from '../ui/jsonStream.js';

/**
 * RFC 8628 device flow client. Two phases:
 *   1. requestDeviceCode -- mint via POST /api/device/request
 *   2. pollForToken      -- poll POST /api/device/token until success/failure
 *
 * Pattern 3 in research: gh CLI's WSL clock-drift safety multiplier
 * (Pitfall 4 mitigation).
 */

const PRIMARY_MULTIPLIER = 1.2;        // +20% baseline (gh CLI default)
const SLOW_DOWN_MULTIPLIER = 1.4;      // +40% after first slow_down
const SLOW_DOWN_INCREMENT_SECONDS = 5; // RFC 8628 §3.5
const POLL_JITTER_MS = 500;
const SLOW_DOWN_HARD_FAIL_COUNT = 2;   // Pitfall 4 escape hatch

export class DeviceFlowExpiredError extends Error {
  constructor() {
    super('Approval timed out after 10 minutes.');
    this.name = 'DeviceFlowExpiredError';
  }
}
export class UserDeniedError extends Error {
  constructor() {
    super('User denied the device approval at /device.');
    this.name = 'UserDeniedError';
  }
}
export class CodeAlreadyUsedError extends Error {
  constructor() {
    super('Device code was already used (replay or race).');
    this.name = 'CodeAlreadyUsedError';
  }
}
export class ClockDriftError extends Error {
  constructor() {
    super('Polling repeatedly throttled. If you are on WSL, run `wsl --update` and try again.');
    this.name = 'ClockDriftError';
  }
}
export class DeviceFlowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DeviceFlowError';
  }
}

export async function requestDeviceCode(apiBase = getApiBase()): Promise<DeviceCodeResponse> {
  const res = await authenticatedFetch(`${apiBase}/api/device/request`, { method: 'POST' });
  if (res.status !== 200) {
    const body = (await res.json().catch(() => ({}))) as Partial<ErrorEnvelope>;
    throw new DeviceFlowError(
      body.code ?? 'request_failed',
      body.error ?? `Failed to request device code (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as DeviceCodeResponse;
  emitEvent({
    type: 'device.code.requested',
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in,
    interval: data.interval,
  });
  return data;
}

export interface PollOpts {
  apiBase?: string;
  deviceCode: string;
  baseIntervalSec: number;
  expiresInSec: number;
  signal: AbortSignal;
  onPoll?: (attempt: number) => void;
}

export async function pollForToken(opts: PollOpts): Promise<TokenPair> {
  const apiBase = opts.apiBase ?? getApiBase();
  let intervalMs = opts.baseIntervalSec * 1000;
  let multiplier = PRIMARY_MULTIPLIER;
  let slowDownCount = 0;
  const expiresAt = Date.now() + opts.expiresInSec * 1000;
  let attempt = 0;

  while (Date.now() < expiresAt) {
    attempt += 1;
    const jitter = Math.floor(Math.random() * (POLL_JITTER_MS * 2)) - POLL_JITTER_MS;
    const waitMs = Math.max(0, intervalMs * multiplier + jitter);
    await wait(waitMs, opts.signal);

    if (opts.onPoll) opts.onPoll(attempt);
    emitEvent({ type: 'device.poll', attempt });

    const body: TokenRequestBody = {
      device_code: opts.deviceCode,
      client_metadata: {
        cli_version: CLI_VERSION,
        hostname: os.hostname(),
        platform: process.platform as 'darwin' | 'linux' | 'win32',
      },
    };
    const res = await authenticatedFetch(`${apiBase}/api/device/token`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (res.status === 200) {
      const tokens = (await res.json()) as TokenPair;
      emitEvent({ type: 'device.token.received' });
      return tokens;
    }

    const env = (await res.json().catch(() => ({}))) as Partial<ErrorEnvelope>;
    const code = env.code ?? '';

    if (code === 'authorization_pending') continue;

    if (code === 'slow_down') {
      slowDownCount += 1;
      if (slowDownCount >= SLOW_DOWN_HARD_FAIL_COUNT) {
        throw new ClockDriftError();
      }
      multiplier = SLOW_DOWN_MULTIPLIER;
      intervalMs += SLOW_DOWN_INCREMENT_SECONDS * 1000;
      continue;
    }

    if (code === 'expired_token') {
      emitEvent({ type: 'device.code.expired' });
      throw new DeviceFlowExpiredError();
    }
    if (code === 'access_denied') throw new UserDeniedError();
    if (code === 'code_consumed') throw new CodeAlreadyUsedError();

    // Unknown error — fail loud.
    throw new DeviceFlowError(code, env.error ?? `Unexpected device-flow error (HTTP ${res.status}).`);
  }

  emitEvent({ type: 'device.code.expired' });
  throw new DeviceFlowExpiredError();
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
