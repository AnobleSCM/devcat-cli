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

describe('sync — idempotency replay (D-15 + D-20)', () => {
  it('retries ONCE on network-level failure with same X-Sync-Idempotency-Key', async () => {
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'eyJa',
        refresh_token: 'eyJr',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockSetPassword.mockResolvedValue(undefined);
    const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
    resetTokenStoreForTests();

    const idempotencyKeysSeen: string[] = [];
    let callCount = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, ({ request }) => {
        idempotencyKeysSeen.push(request.headers.get('x-sync-idempotency-key') ?? '');
        callCount += 1;
        if (callCount === 1) {
          // Simulate connection drop / DNS / TLS failure mid-response
          return HttpResponse.error();
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
    );

    const stdout: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });

      expect(exitCode).toBe(0);
      expect(callCount).toBe(2);
      // SAME key on retry — Phase 40 D-20
      expect(idempotencyKeysSeen[0]).toBe(idempotencyKeysSeen[1]);
      // UUIDv7 format
      expect(idempotencyKeysSeen[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(stdout.join('')).toContain('Sync complete.');
    } finally {
      writeSpy.mockRestore();
      cwdSpy.mockRestore();
    }
  });
});
