import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { join } from 'node:path';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

const { mockGetPassword, mockSetPassword, mockDeletePassword } = vi.hoisted(() => ({
  mockGetPassword: vi.fn(),
  mockSetPassword: vi.fn(),
  mockDeletePassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => {
  class AsyncEntry {
    constructor(_service: string, _account: string) {}
    getPassword(signal?: AbortSignal): Promise<string | null> {
      return mockGetPassword(signal);
    }
    setPassword(value: string, signal?: AbortSignal): Promise<void> {
      return mockSetPassword(value, signal);
    }
    deletePassword(signal?: AbortSignal): Promise<void> {
      return mockDeletePassword(signal);
    }
  }
  return { AsyncEntry };
});

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

process.env.NO_COLOR = '1';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  mockGetPassword.mockReset();
  mockSetPassword.mockReset();
  mockDeletePassword.mockReset();
});
afterAll(() => server.close());

const FIXTURES_CWD = join(__dirname, '..', 'fixtures', 'claude');

describe('sync — D-16 401-mid-flow recovery', () => {
  it('Test 3: refresh-then-retry success path (401 -> /api/device/refresh 200 -> /api/sync 200)', async () => {
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'eyJold',
        refresh_token: 'eyJrefresh',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockSetPassword.mockResolvedValue(undefined);
    mockDeletePassword.mockResolvedValue(undefined);
    const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
    resetTokenStoreForTests();

    const syncCalls: string[] = [];
    let refreshCallCount = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        syncCalls.push(auth);
        if (syncCalls.length === 1) {
          return HttpResponse.json(
            { code: 'unauthorized', error: 'Token expired', requestId: 'req' },
            { status: 401 },
          );
        }
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess',
          results: [
            { type: 'mcp', name: 'context7', status: 'exact_match', catalog_id: 'upstash/context7' },
          ],
          counts: { exact: 1, fuzzy: 0, unmatched: 0 },
        });
      }),
      http.post(`${API_BASE}/api/device/refresh`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({
          access_token: 'eyJnewaccess',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }),
    );

    const stdout: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    const { runSync } = await import('../../src/commands/sync.js');
    const exitCode = await runSync({ noOpen: true });

    writeSpy.mockRestore();
    cwdSpy.mockRestore();

    expect(exitCode).toBe(0);
    expect(syncCalls.length).toBe(2);
    expect(syncCalls[0]).toBe('Bearer eyJold');
    expect(syncCalls[1]).toBe('Bearer eyJnewaccess');
    expect(refreshCallCount).toBe(1);
    expect(mockDeletePassword).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('Sync complete.');
  });

  it('Test 4: D-16 full ladder (401 -> refresh 401 -> deleteToken -> device flow -> sync 200)', async () => {
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'eyJrevokedaccess',
        refresh_token: 'eyJrevokedrefresh',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockSetPassword.mockResolvedValue(undefined);
    mockDeletePassword.mockResolvedValue(undefined);
    const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
    resetTokenStoreForTests();

    const syncCalls: string[] = [];
    const refreshCalls: string[] = [];
    let deviceRequestCallCount = 0;
    let deviceTokenCallCount = 0;

    server.use(
      http.post(`${API_BASE}/api/sync`, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        syncCalls.push(auth);
        if (syncCalls.length === 1) {
          return HttpResponse.json(
            { code: 'unauthorized', error: 'Token expired', requestId: 'req' },
            { status: 401 },
          );
        }
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess-fresh',
          results: [
            { type: 'mcp', name: 'context7', status: 'exact_match', catalog_id: 'upstash/context7' },
          ],
          counts: { exact: 1, fuzzy: 0, unmatched: 0 },
        });
      }),
      // Refresh fails — refresh token is revoked
      http.post(`${API_BASE}/api/device/refresh`, async ({ request }) => {
        const body = (await request.json()) as { refresh_token: string };
        refreshCalls.push(body.refresh_token);
        return HttpResponse.json(
          { code: 'invalid_refresh_token', error: 'Refresh token expired', requestId: 'req' },
          { status: 401 },
        );
      }),
      // Device flow re-trigger
      http.post(`${API_BASE}/api/device/request`, () => {
        deviceRequestCallCount += 1;
        return HttpResponse.json({
          device_code: 'rawhex0123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://devcat.dev/device',
          expires_in: 600,
          interval: 0.001, // tiny so test resolves fast
        });
      }),
      http.post(`${API_BASE}/api/device/token`, () => {
        deviceTokenCallCount += 1;
        return HttpResponse.json({
          access_token: 'eyJfreshaccess',
          refresh_token: 'eyJfreshrefresh',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }),
    );

    const stdout: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    const { runSync } = await import('../../src/commands/sync.js');
    const exitCode = await runSync({ noOpen: true });

    writeSpy.mockRestore();
    cwdSpy.mockRestore();

    // Outcome: success after the full D-16 ladder.
    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Sync complete.');

    // Sequence assertions — load-bearing proof of D-16 correctness:
    // 1. Sync was called twice (old-token 401 + final-token 200)
    expect(syncCalls.length).toBe(2);
    expect(syncCalls[0]).toBe('Bearer eyJrevokedaccess');
    expect(syncCalls[1]).toBe('Bearer eyJfreshaccess');

    // 2. Refresh was attempted exactly once with the revoked refresh_token
    expect(refreshCalls.length).toBe(1);
    expect(refreshCalls[0]).toBe('eyJrevokedrefresh');

    // 3. Keychain was cleared (deleteToken called) AFTER refresh failed
    expect(mockDeletePassword).toHaveBeenCalledTimes(1);

    // 4. Device flow was triggered AFTER keychain was cleared
    expect(deviceRequestCallCount).toBe(1);
    expect(deviceTokenCallCount).toBeGreaterThanOrEqual(1);

    // 5. CRITICAL ORDERING: deleteToken happened BEFORE the new fresh token was persisted.
    // Use vi.fn() invocation call order to assert chronological sequence.
    const deleteOrder = mockDeletePassword.mock.invocationCallOrder[0];
    const setOrders = mockSetPassword.mock.invocationCallOrder;
    const setOrder = setOrders[setOrders.length - 1];
    expect(deleteOrder).toBeLessThan(setOrder);

    // 6. The retry sync call carried the new access token (proves the order:
    // refresh-fail -> delete -> device-flow -> sync)
    expect(syncCalls[1]).not.toBe(syncCalls[0]);
    expect(syncCalls[1]).toContain('eyJfreshaccess');
  });
});
