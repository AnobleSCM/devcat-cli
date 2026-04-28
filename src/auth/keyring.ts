import { AsyncEntry } from '@napi-rs/keyring';
import type { TokenPair } from '../types/api.js';

const SERVICE = 'devcat';
const ACCOUNT = 'cli_session';
const TIMEOUT_MS = 3000;

/**
 * Thrown when @napi-rs/keyring hangs (headless Linux without DBus,
 * WSL without dbus-daemon) OR an underlying SecretService error wraps.
 *
 * Pitfall 1 mitigation. CLI-06 maps this to the user-facing install hint.
 */
export class KeychainUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? 'OS keychain is not available on this system.');
    this.name = 'KeychainUnavailableError';
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Race the fn() against a timeout. The signal is passed through so any
  // backend that honors AbortSignal can short-circuit. But the timeout
  // promise rejects independently — covers the headless-Linux hang case
  // where the underlying C++ binding ignores the signal entirely
  // (Pitfall 1: keytar/keyring hang from D-Bus libsecret handshake).
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(new Error('keychain timeout'));
      reject(new KeychainUnavailableError('OS keychain timed out after 3 seconds.'));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(ac.signal), timeoutPromise]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function readToken(): Promise<TokenPair | null> {
  const entry = new AsyncEntry(SERVICE, ACCOUNT);
  let raw: string | null | undefined;
  try {
    raw = await withTimeout((signal) => entry.getPassword(signal));
  } catch (err) {
    if (err instanceof KeychainUnavailableError) throw err;
    // NoEntry / similar — first run, no token yet
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    // Corrupted entry — delete and start over
    await deleteToken().catch(() => undefined);
    return null;
  }
}

export async function writeToken(token: TokenPair): Promise<void> {
  const entry = new AsyncEntry(SERVICE, ACCOUNT);
  await withTimeout((signal) => entry.setPassword(JSON.stringify(token), signal));
}

export async function deleteToken(): Promise<void> {
  const entry = new AsyncEntry(SERVICE, ACCOUNT);
  await withTimeout((signal) => entry.deletePassword(signal)).catch(() => undefined);
}
