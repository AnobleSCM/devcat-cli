import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenPair } from '../../../src/types/api.js';

// Mock @napi-rs/keyring at the top so AsyncEntry is intercepted.
// Use vi.hoisted() so the mock fns are reachable from the vi.mock factory
// (vitest hoists vi.mock above all imports). vitest 4.x rejects vi.fn() as
// a constructor — must be a real class. AsyncEntry instances delegate to
// the hoisted spy fns so the test can drive return/throw behavior.
const { mockGetPassword, mockSetPassword, mockDeletePassword } = vi.hoisted(() => ({
  mockGetPassword: vi.fn(),
  mockSetPassword: vi.fn(),
  mockDeletePassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => {
  class AsyncEntry {
    constructor(_service: string, _account: string) { /* noop */ }
    getPassword(signal?: AbortSignal): Promise<string | undefined | null> {
      return mockGetPassword(signal);
    }
    setPassword(password: string, signal?: AbortSignal): Promise<void> {
      return mockSetPassword(password, signal);
    }
    deletePassword(signal?: AbortSignal): Promise<unknown> {
      return mockDeletePassword(signal);
    }
  }
  return { AsyncEntry };
});

import { readToken, writeToken, deleteToken, KeychainUnavailableError } from '../../../src/auth/keyring.js';

const SAMPLE: TokenPair = {
  access_token: 'eyJabc',
  refresh_token: 'eyJrefresh',
  expires_in: 3600,
  token_type: 'Bearer',
};

describe('keyring wrapper', () => {
  beforeEach(() => {
    mockGetPassword.mockReset();
    mockSetPassword.mockReset();
    mockDeletePassword.mockReset();
  });

  it('readToken returns null when entry is empty', async () => {
    mockGetPassword.mockResolvedValue(null);
    const result = await readToken();
    expect(result).toBeNull();
  });

  it('readToken returns parsed TokenPair when entry has JSON', async () => {
    mockGetPassword.mockResolvedValue(JSON.stringify(SAMPLE));
    const result = await readToken();
    expect(result).toEqual(SAMPLE);
  });

  it('writeToken serializes JSON', async () => {
    mockSetPassword.mockResolvedValue(undefined);
    await writeToken(SAMPLE);
    expect(mockSetPassword).toHaveBeenCalledTimes(1);
    const arg = mockSetPassword.mock.calls[0]![0];
    expect(JSON.parse(arg)).toEqual(SAMPLE);
  });

  // W4 fix: use vi.useFakeTimers() so the 3-second timeout resolves
  // virtually, not in real wall-clock time. Across the 6-env CI matrix
  // this saves 18 real seconds total. The `withTimeout` helper inside
  // src/auth/keyring.ts uses setTimeout + AbortController; both are
  // intercepted by vitest fake timers when shouldAdvanceTime is false.
  //
  // Pattern: kick off the readToken() promise, attach a .catch handler
  // synchronously to capture the rejection, advance virtual time past
  // TIMEOUT_MS, then assert. This avoids the Promise-vs-microtask
  // ordering issue where expect().rejects suspends the test before timers
  // get a chance to advance.
  it('readToken throws KeychainUnavailableError on timeout (fake timers — no real wait)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      mockGetPassword.mockImplementation(() => new Promise(() => { /* never resolves */ }));
      let caught: unknown = null;
      const promise = readToken().catch((err: unknown) => { caught = err; });
      // Advance virtual time past the 3-second TIMEOUT_MS threshold;
      // advanceTimersByTimeAsync flushes the resulting microtask chain.
      await vi.advanceTimersByTimeAsync(3100);
      await promise;
      expect(caught).toBeInstanceOf(KeychainUnavailableError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deleteToken is idempotent (does not throw on empty)', async () => {
    mockDeletePassword.mockRejectedValue(new Error('NoEntry'));
    await expect(deleteToken()).resolves.toBeUndefined();
  });

  it('readToken returns null when entry is corrupt JSON', async () => {
    mockGetPassword.mockResolvedValue('{not valid json');
    mockDeletePassword.mockResolvedValue(undefined);
    const result = await readToken();
    expect(result).toBeNull();
  });
});
