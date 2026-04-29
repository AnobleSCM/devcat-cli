import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from 'vitest';
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

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirHolder.current ?? actual.homedir(),
  };
});

const FIXTURES_CWD = join(__dirname, '..', 'fixtures', 'claude');
const originalArgv = process.argv;

process.env.NO_COLOR = '1';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  homedirHolder.current = mkdtempSync(join(tmpdir(), 'devcat-json-home-'));
  process.argv = ['node', 'devcat', 'sync', '--json'];
  vi.resetModules();
  const { resetJsonModeCacheForTests } = await import('../../src/ui/jsonStream.js');
  const { resetTokenStoreForTests } = await import('../../src/auth/tokenStore.js');
  resetJsonModeCacheForTests();
  resetTokenStoreForTests();
});
afterEach(() => {
  server.resetHandlers();
  mockGetPassword.mockReset();
  mockSetPassword.mockReset();
  mockDeletePassword.mockReset();
  if (homedirHolder.current) {
    rmSync(homedirHolder.current, { recursive: true, force: true });
    homedirHolder.current = null;
  }
  process.argv = originalArgv;
});
afterAll(() => server.close());

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  return { chunks, restore: () => spy.mockRestore() };
}

function parseJsonLines(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .join('')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectNonEmptySyncStart(event: Record<string, unknown>): void {
  expect(event.type).toBe('sync.start');
  expect(event.tool_count).toEqual(expect.any(Number));
  expect(event.tool_count as number).toBeGreaterThan(0);
  expect(event.idempotency_key).toEqual(expect.any(String));
}

describe('sync --json event sequence', () => {
  it('emits sync.start before sync.error when first-run device request fails', async () => {
    mockGetPassword.mockResolvedValue(null);
    server.use(
      http.post(`${API_BASE}/api/device/request`, () =>
        HttpResponse.text('Authentication required', {
          status: 401,
          headers: { 'www-authenticate': 'Basic realm="DevCat"' },
        }),
      ),
    );

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(1);
      expect(events.map((event) => event.type)).toEqual(['sync.start', 'sync.error']);
      expectNonEmptySyncStart(events[0]);
      expect(events[1]).toMatchObject({
        type: 'sync.error',
        message: 'Failed to request device code (HTTP 401).',
        exit_code: 1,
      });
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
    }
  });

  it('emits exactly one sync.start on stored-token success', async () => {
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'eyJa',
        refresh_token: 'eyJr',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockSetPassword.mockResolvedValue(undefined);
    server.use(
      http.post(`${API_BASE}/api/sync`, () =>
        HttpResponse.json({
          synced_at: '2026-04-28T12:00:00Z',
          session_id: 'sess',
          results: [
            { type: 'mcp', name: 'context7', status: 'exact_match', catalog_id: 'upstash/context7' },
          ],
          counts: { exact: 1, fuzzy: 0, unmatched: 0 },
        }),
      ),
    );

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(0);
      expect(events.map((event) => event.type)).toEqual(['sync.start', 'sync.success']);
      expect(events.filter((event) => event.type === 'sync.start')).toHaveLength(1);
      expectNonEmptySyncStart(events[0]);
      expect(events[1]).toMatchObject({
        type: 'sync.success',
        counts: { exact: 1, fuzzy: 0, unmatched: 0 },
      });
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
    }
  });

  it('emits one sync.start before terminal device-token expiry', async () => {
    mockGetPassword.mockResolvedValue(null);
    server.use(
      http.post(`${API_BASE}/api/device/request`, () =>
        HttpResponse.json({
          device_code: 'rawhex0123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://devcat.dev/device',
          expires_in: 1,
          interval: 0,
        }),
      ),
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'expired_token', error: 'Device code expired.', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(2);
      expectNonEmptySyncStart(events[0]);
      expect(events.filter((event) => event.type === 'sync.start')).toHaveLength(1);
      expect(events.map((event) => event.type)).toContain('device.code.requested');
      expect(events.map((event) => event.type)).toContain('device.code.expired');
      expect(events.at(-1)).toMatchObject({
        type: 'sync.error',
        message: 'Approval timed out after 10 minutes. Run `npx devcat-cli sync` again to get a new code.',
        exit_code: 2,
      });
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
    }
  });

  it('emits one sync.start when sync 401 recovery falls through to device-request failure', async () => {
    mockGetPassword.mockResolvedValue(
      JSON.stringify({
        access_token: 'expired-access',
        refresh_token: 'expired-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    mockDeletePassword.mockResolvedValue(undefined);
    server.use(
      http.post(`${API_BASE}/api/sync`, () =>
        HttpResponse.json(
          { code: 'unauthorized', error: 'Authentication required', requestId: 'req' },
          { status: 401 },
        ),
      ),
      http.post(`${API_BASE}/api/device/refresh`, () =>
        HttpResponse.json(
          { code: 'invalid_refresh_token', error: 'Refresh expired.', requestId: 'req' },
          { status: 401 },
        ),
      ),
      http.post(`${API_BASE}/api/device/request`, () =>
        HttpResponse.text('Authentication required', { status: 401 }),
      ),
    );

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(1);
      expectNonEmptySyncStart(events[0]);
      expect(events.filter((event) => event.type === 'sync.start')).toHaveLength(1);
      expect(events.map((event) => event.type)).toContain('auth.refresh.failed');
      expect(events.at(-1)).toMatchObject({
        type: 'sync.error',
        message: 'Failed to request device code (HTTP 401).',
        exit_code: 1,
      });
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
    }
  });

  it('emits sync.start before sync.error when device request has a network failure', async () => {
    mockGetPassword.mockResolvedValue(null);
    server.use(http.post(`${API_BASE}/api/device/request`, () => HttpResponse.error()));

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(FIXTURES_CWD);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(2);
      expectNonEmptySyncStart(events[0]);
      expect(events.filter((event) => event.type === 'sync.start')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('sync.error');
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
    }
  });

  it('emits exactly one sync.start for an empty manifest', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'devcat-json-empty-'));
    mockGetPassword.mockResolvedValue(null);

    const stdout = captureStdout();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);

    try {
      const { runSync } = await import('../../src/commands/sync.js');
      const exitCode = await runSync({ noOpen: true });
      const events = parseJsonLines(stdout.chunks);

      expect(exitCode).toBe(0);
      expect(events.map((event) => event.type)).toEqual(['sync.start', 'sync.success']);
      expect(events.filter((event) => event.type === 'sync.start')).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'sync.start', tool_count: 0 });
    } finally {
      stdout.restore();
      cwdSpy.mockRestore();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
