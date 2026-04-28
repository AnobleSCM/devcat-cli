import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { authenticatedFetch } from '../../../src/api/client.js';

const API_BASE = 'https://devcat.dev';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('authenticatedFetch', () => {
  it('sets User-Agent on every request', async () => {
    let capturedUA = '';
    server.use(
      http.get(`${API_BASE}/probe`, ({ request }) => {
        capturedUA = request.headers.get('user-agent') ?? '';
        return HttpResponse.json({ ok: true });
      }),
    );
    await authenticatedFetch(`${API_BASE}/probe`);
    expect(capturedUA).toMatch(/^devcat-cli\/0\.1\.0 \((darwin|linux|win32); node /);
  });

  it('sets Authorization: Bearer when bearerToken passed', async () => {
    let capturedAuth = '';
    server.use(
      http.get(`${API_BASE}/auth-probe`, ({ request }) => {
        capturedAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ ok: true });
      }),
    );
    await authenticatedFetch(`${API_BASE}/auth-probe`, { bearerToken: 'eyJtest' });
    expect(capturedAuth).toBe('Bearer eyJtest');
  });

  it('sets Content-Type: application/json on POST with body', async () => {
    let capturedCT = '';
    server.use(
      http.post(`${API_BASE}/post-probe`, ({ request }) => {
        capturedCT = request.headers.get('content-type') ?? '';
        return HttpResponse.json({ ok: true });
      }),
    );
    await authenticatedFetch(`${API_BASE}/post-probe`, {
      method: 'POST',
      body: JSON.stringify({ x: 1 }),
    });
    expect(capturedCT).toBe('application/json');
  });

  it('redacts Authorization header in debug log (security boundary)', async () => {
    // Capture stderr while making a request with --verbose; assert the
    // Authorization Bearer token never appears in the debug stream.
    server.use(
      http.get(`${API_BASE}/redact-probe`, () => HttpResponse.json({ ok: true })),
    );

    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const origArgv = process.argv;
    process.argv = [...origArgv, '--verbose'];
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      await authenticatedFetch(`${API_BASE}/redact-probe`, {
        bearerToken: 'eyJSECRETTOKEN',
      });
    } finally {
      process.stderr.write = origWrite;
      process.argv = origArgv;
    }
    const all = captured.join('');
    expect(all).toContain('[REDACTED]');
    expect(all).not.toContain('eyJSECRETTOKEN');
  });
});
