import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactHeaders, redactBody, debugLog } from '../../../src/lib/debugLog.js';

describe('redactHeaders', () => {
  it('redacts Authorization Bearer token while preserving the scheme', () => {
    const out = redactHeaders({ Authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.payload.sig' });
    expect(out.Authorization).toBe('Bearer [REDACTED]');
  });

  it('redacts Basic auth (case-insensitive header name)', () => {
    const out = redactHeaders({ authorization: 'Basic dXNlcjpwYXNzd29yZA==' });
    expect(out.authorization).toBe('Basic [REDACTED]');
  });

  it('redacts cookie header values fully (no scheme prefix)', () => {
    const out = redactHeaders({ cookie: 'session=abc123; csrf=xyz789' });
    expect(out.cookie).toBe('[REDACTED]');
  });

  it('preserves non-sensitive headers unchanged', () => {
    const out = redactHeaders({
      'content-type': 'application/json',
      'x-request-id': 'req-1234',
    });
    expect(out['content-type']).toBe('application/json');
    expect(out['x-request-id']).toBe('req-1234');
  });
});

describe('redactBody', () => {
  it('redacts access_token and refresh_token while preserving non-sensitive fields', () => {
    const out = redactBody({
      access_token: 'eyJhbGc.payload.sig',
      refresh_token: 'eyJrZWY.refresh.sig',
      user_id: 'uuid-abc',
      expires_in: 3600,
    });
    expect(out).toEqual({
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      user_id: 'uuid-abc',
      expires_in: 3600,
    });
  });

  it('redacts device_code, user_code, password, *_secret, *_token (case-insensitive keys)', () => {
    const out = redactBody({
      device_code: 'aabbccdd',
      user_code: 'ABCD-EFGH',
      password: 'hunter2',
      api_secret: 'sk_live_xxx',
      github_token: 'ghp_xxx',
      DEVICE_CODE: 'AABBCCDD',
    });
    expect(out).toEqual({
      device_code: '[REDACTED]',
      user_code: '[REDACTED]',
      password: '[REDACTED]',
      api_secret: '[REDACTED]',
      github_token: '[REDACTED]',
      DEVICE_CODE: '[REDACTED]',
    });
  });

  it('recursively redacts inside arrays', () => {
    const out = redactBody([
      { access_token: 'leak', user_id: 'a' },
      { access_token: 'leak2', user_id: 'b' },
    ]);
    expect(out).toEqual([
      { access_token: '[REDACTED]', user_id: 'a' },
      { access_token: '[REDACTED]', user_id: 'b' },
    ]);
  });

  it('handles null, undefined, and primitives without crashing', () => {
    expect(redactBody(null)).toBe(null);
    expect(redactBody(undefined)).toBe(undefined);
    expect(redactBody('plain string')).toBe('plain string');
    expect(redactBody(42)).toBe(42);
    expect(redactBody(true)).toBe(true);
  });

  it('recursively descends into nested objects', () => {
    const out = redactBody({
      outer: { inner: { access_token: 'leak', safe: 'ok' } },
    });
    expect(out).toEqual({
      outer: { inner: { access_token: '[REDACTED]', safe: 'ok' } },
    });
  });
});

describe('debugLog', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv: string[];
  let originalDebugEnv: string | undefined;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalArgv = process.argv;
    originalDebugEnv = process.env.DEVCAT_DEBUG;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.argv = originalArgv;
    if (originalDebugEnv !== undefined) process.env.DEVCAT_DEBUG = originalDebugEnv;
    else delete process.env.DEVCAT_DEBUG;
  });

  it('emits redacted body to stderr when --verbose flag is present', () => {
    process.argv = ['node', 'devcat', 'sync', '--verbose'];
    delete process.env.DEVCAT_DEBUG;
    debugLog('POST /api/sync', { body: { access_token: 'leak-me' } });
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('POST /api/sync');
    expect(written).not.toContain('leak-me');
    expect(written).toContain('[REDACTED]');
  });

  it('emits nothing when --verbose flag is absent and DEVCAT_DEBUG is unset', () => {
    process.argv = ['node', 'devcat', 'sync'];
    delete process.env.DEVCAT_DEBUG;
    debugLog('POST /api/sync', { body: { access_token: 'leak-me' } });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits when DEVCAT_DEBUG env var is set, even without --verbose', () => {
    process.argv = ['node', 'devcat', 'sync'];
    process.env.DEVCAT_DEBUG = '1';
    debugLog('POST /api/sync');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('writes to stderr (not stdout)', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.argv = ['node', 'devcat', 'sync', '-v'];
      debugLog('test message');
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
