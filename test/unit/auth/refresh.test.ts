import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { refreshAccessToken, RefreshTokenInvalidError } from '../../../src/auth/refresh.js';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('refreshAccessToken', () => {
  it('returns RefreshResponse on 200', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/refresh`, () =>
        HttpResponse.json({
          access_token: 'eyJnewaccess',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      ),
    );
    const result = await refreshAccessToken({ apiBase: API_BASE, refreshToken: 'eyJold' });
    expect(result.access_token).toBe('eyJnewaccess');
  });

  it('throws RefreshTokenInvalidError on 401 invalid_refresh_token', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/refresh`, () =>
        HttpResponse.json(
          { code: 'invalid_refresh_token', error: 'Refresh token expired', requestId: 'req' },
          { status: 401 },
        ),
      ),
    );
    await expect(
      refreshAccessToken({ apiBase: API_BASE, refreshToken: 'eyJexpired' }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('throws generic Error on 500', async () => {
    server.use(
      http.post(`${API_BASE}/api/device/refresh`, () =>
        HttpResponse.json(
          { code: 'internal_error', error: 'Service unavailable', requestId: 'req' },
          { status: 500 },
        ),
      ),
    );
    await expect(
      refreshAccessToken({ apiBase: API_BASE, refreshToken: 'eyJany' }),
    ).rejects.toThrow(/Service unavailable|Refresh failed/);
  });
});
