import {
  readToken as keychainRead,
  writeToken as keychainWrite,
  deleteToken as keychainDelete,
  KeychainUnavailableError,
} from './keyring.js';
import type { TokenPair } from '../types/api.js';

/**
 * In-memory token holder. CI-only escape hatch (DEVCAT_TOKEN env var)
 * skips keychain entirely. Anyone calling load/save MUST handle
 * KeychainUnavailableError gracefully (the CLI prints CLI-06 hint and
 * either uses DEVCAT_TOKEN or fails).
 */
let memoryToken: TokenPair | null = null;

export { KeychainUnavailableError };

export async function loadToken(): Promise<TokenPair | null> {
  // CI escape hatch: DEVCAT_TOKEN env var
  if (process.env.DEVCAT_TOKEN) {
    return {
      access_token: process.env.DEVCAT_TOKEN,
      refresh_token: '',
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }
  if (memoryToken) return memoryToken;
  const persisted = await keychainRead();
  if (persisted) memoryToken = persisted;
  return persisted;
}

export async function saveToken(token: TokenPair): Promise<void> {
  memoryToken = token;
  await keychainWrite(token);
}

/** In-memory only — used after KeychainUnavailableError. Token expires when CLI exits. */
export function saveTokenInMemoryOnly(token: TokenPair): void {
  memoryToken = token;
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  await keychainDelete();
}

/** For tests — reset internal memory. */
export function resetTokenStoreForTests(): void {
  memoryToken = null;
}
