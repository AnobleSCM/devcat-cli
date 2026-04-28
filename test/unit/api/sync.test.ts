import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  postSync,
  TokenInvalidError,
  SyncFailedError,
  NetworkFailedError,
} from '../../../src/api/sync.js';
import type { ToolType } from '../../../src/types/api.js';

const API_BASE = 'https://devcat.dev';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SAMPLE_TOOLS: Array<{ type: ToolType; name: string }> = [
  { type: 'mcp', name: 'context7' },
  { type: 'mcp', name: 'linear-mcp' },
];

describe('postSync', () => {
  it('returns SyncResponseBody on 200', async () => {
    let capturedKey = '';
    let capturedAuth = '';
    server.use(
      http.post(`${API_BASE}/api/sync`, ({ request }) => {
        capturedKey = request.headers.get('x-sync-idempotency-key') ?? '';
        capturedAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess-uuid',
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
    const result = await postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: SAMPLE_TOOLS });
    expect(result.counts.exact).toBe(1);
    expect(result.counts.fuzzy).toBe(1);
    expect(capturedAuth).toBe('Bearer eyJa');
    // UUIDv7 format: timestamp-tagged variant 7
    expect(capturedKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('throws TokenInvalidError on 401', async () => {
    server.use(
      http.post(`${API_BASE}/api/sync`, () =>
        HttpResponse.json(
          { code: 'unauthorized', error: 'Authentication required', requestId: 'req' },
          { status: 401 },
        ),
      ),
    );
    await expect(
      postSync({ apiBase: API_BASE, accessToken: 'expired', tools: SAMPLE_TOOLS }),
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('throws SyncFailedError on 400 schema_violation', async () => {
    server.use(
      http.post(`${API_BASE}/api/sync`, () =>
        HttpResponse.json(
          { code: 'schema_violation', error: 'Manifest failed validation.', requestId: 'req' },
          { status: 400 },
        ),
      ),
    );
    await expect(
      postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: SAMPLE_TOOLS }),
    ).rejects.toBeInstanceOf(SyncFailedError);
  });

  it('does NOT retry on 4xx/5xx (Phase 40 D-15 fail-loud)', async () => {
    let count = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, () => {
        count += 1;
        return HttpResponse.json(
          { code: 'rate_limit_exceeded', error: 'Too many', requestId: 'req' },
          { status: 429 },
        );
      }),
    );
    await expect(
      postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: SAMPLE_TOOLS }),
    ).rejects.toBeInstanceOf(SyncFailedError);
    expect(count).toBe(1);
  });

  it('retries ONCE on network-level failure with same idempotency key', async () => {
    const seenKeys: string[] = [];
    let count = 0;
    server.use(
      http.post(`${API_BASE}/api/sync`, ({ request }) => {
        seenKeys.push(request.headers.get('x-sync-idempotency-key') ?? '');
        count += 1;
        if (count === 1) return HttpResponse.error();
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess',
          results: [],
          counts: { exact: 0, fuzzy: 0, unmatched: 0 },
        });
      }),
    );
    await postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: [] });
    expect(count).toBe(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
    expect(seenKeys[0]).not.toBe('');
  });

  it('throws NetworkFailedError after second network-level failure', async () => {
    server.use(http.post(`${API_BASE}/api/sync`, () => HttpResponse.error()));
    await expect(
      postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: [] }),
    ).rejects.toBeInstanceOf(NetworkFailedError);
  });

  it('sends manifest_hash that is SHA-256 hex', async () => {
    let captured: { manifest_hash?: string } = {};
    server.use(
      http.post(`${API_BASE}/api/sync`, async ({ request }) => {
        captured = (await request.json()) as { manifest_hash?: string };
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess',
          results: [],
          counts: { exact: 0, fuzzy: 0, unmatched: 0 },
        });
      }),
    );
    await postSync({ apiBase: API_BASE, accessToken: 'eyJa', tools: SAMPLE_TOOLS });
    expect(captured.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('manifestHash is stable across input ordering', async () => {
    let firstHash = '';
    let secondHash = '';
    server.use(
      http.post(`${API_BASE}/api/sync`, async ({ request }) => {
        const body = (await request.json()) as { manifest_hash: string };
        if (!firstHash) firstHash = body.manifest_hash;
        else secondHash = body.manifest_hash;
        return HttpResponse.json({
          synced_at: '2026-04-27T12:00:00Z',
          session_id: 'sess',
          results: [],
          counts: { exact: 0, fuzzy: 0, unmatched: 0 },
        });
      }),
    );
    await postSync({
      apiBase: API_BASE,
      accessToken: 'eyJa',
      tools: [
        { type: 'mcp', name: 'a' },
        { type: 'mcp', name: 'b' },
      ],
    });
    await postSync({
      apiBase: API_BASE,
      accessToken: 'eyJa',
      tools: [
        { type: 'mcp', name: 'b' },
        { type: 'mcp', name: 'a' },
      ],
    });
    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
