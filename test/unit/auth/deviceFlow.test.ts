import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  requestDeviceCode,
  pollForToken,
  DeviceFlowExpiredError,
  UserDeniedError,
  CodeAlreadyUsedError,
  ClockDriftError,
} from '../../../src/auth/deviceFlow.js';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('requestDeviceCode', () => {
  it('returns parsed body on 200', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/request`, () =>
        HttpResponse.json({
          device_code: 'rawhex0123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://devcat.dev/device',
          expires_in: 600,
          interval: 5,
        }),
      ),
    );
    const result = await requestDeviceCode(API_BASE);
    expect(result.user_code).toBe('ABCD-EFGH');
    expect(result.expires_in).toBe(600);
  });

  it('throws on 500', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/request`, () =>
        HttpResponse.json(
          { code: 'internal_error', error: 'Service temporarily unavailable', requestId: 'req_test' },
          { status: 500 },
        ),
      ),
    );
    await expect(requestDeviceCode(API_BASE)).rejects.toThrow();
  });
});

describe('pollForToken', () => {
  it('returns TokenPair on first 200', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json({
          access_token: 'eyJa',
          refresh_token: 'eyJr',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      ),
    );
    const ac = new AbortController();
    const result = await pollForToken({
      apiBase: API_BASE,
      deviceCode: 'rawhex',
      baseIntervalSec: 0.001,
      expiresInSec: 5,
      signal: ac.signal,
    });
    expect(result.access_token).toBe('eyJa');
  });

  it('continues on authorization_pending then succeeds', async () => {
    let count = 0;
    server.use(
      http.post(`${API_BASE}/api/device/token`, () => {
        count += 1;
        if (count < 2) {
          return HttpResponse.json(
            { code: 'authorization_pending', error: 'Pending', requestId: 'req' },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          access_token: 'eyJa',
          refresh_token: 'eyJr',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }),
    );
    const ac = new AbortController();
    const result = await pollForToken({
      apiBase: API_BASE,
      deviceCode: 'rawhex',
      baseIntervalSec: 0.001,
      expiresInSec: 5,
      signal: ac.signal,
    });
    expect(count).toBe(2);
    expect(result.access_token).toBe('eyJa');
  });

  it('throws DeviceFlowExpiredError on expired_token', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'expired_token', error: 'Expired', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    await expect(
      pollForToken({
        apiBase: API_BASE,
        deviceCode: 'rawhex',
        baseIntervalSec: 0.001,
        expiresInSec: 5,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(DeviceFlowExpiredError);
  });

  it('throws UserDeniedError on access_denied', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'access_denied', error: 'Denied', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    await expect(
      pollForToken({
        apiBase: API_BASE,
        deviceCode: 'rawhex',
        baseIntervalSec: 0.001,
        expiresInSec: 5,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(UserDeniedError);
  });

  it('throws CodeAlreadyUsedError on code_consumed', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'code_consumed', error: 'Consumed', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    await expect(
      pollForToken({
        apiBase: API_BASE,
        deviceCode: 'rawhex',
        baseIntervalSec: 0.001,
        expiresInSec: 5,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(CodeAlreadyUsedError);
  });

  // The slow_down branch adds SLOW_DOWN_INCREMENT_SECONDS (5s) to
  // intervalMs and bumps the multiplier to 1.4. The second poll waits
  // (1ms + 5000ms) * 1.4 ≈ 7s in real wall-clock time. We accept this
  // real-time cost (Pitfall 4 mitigation has inherent timing) and bump
  // the per-test timeout to 15s — leaves headroom on slower Windows CI.
  // Fake timers don't help here because msw's fetch interception
  // resolves through async microtasks the fake timer scheduler doesn't
  // drive cleanly.
  it('throws ClockDriftError after two slow_down responses (Pitfall 4 escape)', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'slow_down', error: 'Slow down', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    await expect(
      pollForToken({
        apiBase: API_BASE,
        deviceCode: 'rawhex',
        baseIntervalSec: 0.001,
        expiresInSec: 30,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(ClockDriftError);
  }, 15_000);

  it('respects AbortSignal', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'authorization_pending', error: 'Pending', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    const promise = pollForToken({
      apiBase: API_BASE,
      deviceCode: 'rawhex',
      baseIntervalSec: 1, // 1 second baseline
      expiresInSec: 60,
      signal: ac.signal,
    });
    // Abort during the first wait window
    setTimeout(() => ac.abort(new Error('user-aborted')), 50);
    await expect(promise).rejects.toThrow();
  });

  it('throws DeviceFlowExpiredError when expiresInSec elapses', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/token`, () =>
        HttpResponse.json(
          { code: 'authorization_pending', error: 'Pending', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    const ac = new AbortController();
    // 0.05 expiresInSec => first iteration check exits the loop before
    // reaching the network call.
    await expect(
      pollForToken({
        apiBase: API_BASE,
        deviceCode: 'rawhex',
        baseIntervalSec: 0.001,
        expiresInSec: 0.05,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(DeviceFlowExpiredError);
  });

  it('POST body includes client_metadata (cli_version, hostname, platform)', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${API_BASE}/api/device/token`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          access_token: 'eyJa',
          refresh_token: 'eyJr',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }),
    );
    const ac = new AbortController();
    await pollForToken({
      apiBase: API_BASE,
      deviceCode: 'rawhex',
      baseIntervalSec: 0.001,
      expiresInSec: 5,
      signal: ac.signal,
    });
    const body = capturedBody as {
      client_metadata?: { cli_version?: string; hostname?: string; platform?: string };
    };
    expect(body.client_metadata?.cli_version).toBe('0.1.0');
    expect(['darwin', 'linux', 'win32']).toContain(body.client_metadata?.platform);
    expect(typeof body.client_metadata?.hostname).toBe('string');
  });
});
