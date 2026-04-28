import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

const { mockGetPassword, mockSetPassword, mockDeletePassword } = vi.hoisted(() => ({
  mockGetPassword: vi.fn(),
  mockSetPassword: vi.fn(),
  mockDeletePassword: vi.fn(),
}));

// Cross-platform homedir override (Plan 39-02 pattern). HOME env var doesn't
// redirect os.homedir() on Windows.
const homedirHolder: { current: string | null } = { current: null };

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

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirHolder.current ?? actual.homedir(),
  };
});

process.env.NO_COLOR = '1';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  mockGetPassword.mockReset();
  mockSetPassword.mockReset();
  mockDeletePassword.mockReset();
  homedirHolder.current = null;
});
afterAll(() => server.close());

describe('sync — empty manifest (D-09)', () => {
  it('exits 0 with friendly message and ZERO server calls when no tools detected', async () => {
    // Empty cwd: no .mcp.json, no .codex/config.toml, no .cursor/mcp.json.
    const emptyDir = mkdtempSync(join(tmpdir(), 'devcat-empty-'));
    // Empty home dir: no ~/.claude.json, no ~/.codex/config.toml, etc.
    const emptyHome = mkdtempSync(join(tmpdir(), 'devcat-empty-home-'));
    homedirHolder.current = emptyHome;

    // No token needed — empty path exits before keychain access
    mockGetPassword.mockResolvedValue(null);
    const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
    resetTokenStoreForTests();

    let syncCallCount = 0;
    let deviceCallCount = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, () => {
        syncCallCount += 1;
        return HttpResponse.json({}, { status: 200 });
      }),
      http.post(`${API_BASE}/api/device/request`, () => {
        deviceCallCount += 1;
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const stdout: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const out = stdout.join('');

      expect(exitCode).toBe(0);
      expect(out).toContain('No AI tools detected');
      expect(out).toContain('Nothing to sync');
      expect(syncCallCount).toBe(0); // CRITICAL: no /api/sync round-trip
      expect(deviceCallCount).toBe(0); // No device flow either
    } finally {
      writeSpy.mockRestore();
      cwdSpy.mockRestore();
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
