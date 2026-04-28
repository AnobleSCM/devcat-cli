import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { join } from 'node:path';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

// vi.hoisted refs let class methods inside the vi.mock factory delegate to
// per-test vi.fn() mocks. vi.fn().mockImplementation(...) used as a
// constructor throws under vitest 4.x — see Plan 39-03 keyring.test.ts.
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

describe('sync — success path with stored token', () => {
  beforeEach(async () => {
    // Token already stored
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'eyJa',
        refresh_token: 'eyJr',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockSetPassword.mockResolvedValue(undefined);
    // Reset in-memory token cache between tests
    const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
    resetTokenStoreForTests();
  });

  it('renders Phase 40 D-19 summary on stdout', async () => {
    let syncCallCount = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, () => {
        syncCallCount += 1;
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess',
          results: [
            { type: 'mcp', name: 'context7', status: 'exact_match', catalog_id: 'upstash/context7' },
            {
              type: 'mcp',
              name: 'linear-mcp',
              status: 'fuzzy_match',
              catalog_id: 'jerhadf/linear-mcp-server',
              confidence: 0.87,
            },
          ],
          counts: { exact: 1, fuzzy: 1, unmatched: 0 },
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
    const out = stdout.join('');

    writeSpy.mockRestore();
    cwdSpy.mockRestore();

    expect(exitCode).toBe(0);
    expect(syncCallCount).toBe(1);
    expect(out).toContain('Pushed');
    expect(out).toContain('Sync complete.');
  });
});
