import { describe, it, expect } from 'vitest';
import { renderSuccessSummary, renderEmptyManifest, renderUserCodePrompt } from '../../../src/ui/render.js';
import type { SyncResponseBody, DeviceCodeResponse } from '../../../src/types/api.js';

// In Vitest fork pools process.stdout.isTTY is undefined (falsy) so colors
// auto-strip; setting NO_COLOR is belt-and-suspenders for any CI shape that
// might still have isTTY truthy.
process.env.NO_COLOR = '1';

describe('renderSuccessSummary (Phase 40 D-19 byte-lock)', () => {
  it('matches the locked 10-tool example output', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess-uuid',
      results: [
        ...Array.from({ length: 7 }, (_, i) => ({
          type: 'mcp' as const,
          name: `m${i}`,
          status: 'exact_match' as const,
          catalog_id: `cat${i}`,
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          type: 'mcp' as const,
          name: `f${i}`,
          status: 'fuzzy_match' as const,
          catalog_id: `catf${i}`,
          confidence: 0.88,
        })),
        { type: 'mcp' as const, name: 'linear-mcp-custom', status: 'unmatched' as const, catalog_id: null },
      ],
      counts: { exact: 7, fuzzy: 2, unmatched: 1 },
    };
    const out = renderSuccessSummary(body);
    // Header line
    expect(out).toContain('✓');
    expect(out).toContain('Pushed 10 tools to devcat.dev');
    // Category lines
    expect(out).toContain('7 matched');
    expect(out).toContain('ready in My Tools');
    expect(out).toContain('2 matched (fuzzy)');
    expect(out).toContain('review at https://devcat.dev/my-tools');
    expect(out).toContain('1 unmatched');
    expect(out).toContain('linear-mcp-custom');
    expect(out).toContain('(no catalog match — still synced)');
    // Footer
    expect(out).toContain('Sync complete.');
  });

  it('omits zero-count categories', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess-uuid',
      results: [{ type: 'mcp', name: 'context7', status: 'exact_match', catalog_id: 'upstash/context7' }],
      counts: { exact: 1, fuzzy: 0, unmatched: 0 },
    };
    const out = renderSuccessSummary(body);
    expect(out).toContain('1 matched');
    expect(out).not.toContain('matched (fuzzy)');
    expect(out).not.toContain('unmatched');
    expect(out).toContain('Sync complete.');
  });

  it('singular vs plural', () => {
    const single: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess',
      results: [{ type: 'mcp', name: 'one', status: 'exact_match', catalog_id: 'one' }],
      counts: { exact: 1, fuzzy: 0, unmatched: 0 },
    };
    expect(renderSuccessSummary(single)).toContain('Pushed 1 tool to');
  });

  it('0 unmatched: produces no "unmatched" line at all', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess',
      results: [
        { type: 'mcp', name: 'a', status: 'exact_match', catalog_id: 'a' },
        { type: 'mcp', name: 'b', status: 'fuzzy_match', catalog_id: 'b', confidence: 0.9 },
      ],
      counts: { exact: 1, fuzzy: 1, unmatched: 0 },
    };
    const out = renderSuccessSummary(body);
    expect(out).not.toContain('unmatched');
    expect(out).not.toContain('no catalog match');
  });

  it('1 unmatched: shows the single name (D-19 byte-lock case)', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess',
      results: [
        { type: 'mcp', name: 'linear-mcp-custom', status: 'unmatched', catalog_id: null },
      ],
      counts: { exact: 0, fuzzy: 0, unmatched: 1 },
    };
    const out = renderSuccessSummary(body);
    expect(out).toContain('1 unmatched');
    expect(out).toContain('linear-mcp-custom (no catalog match — still synced)');
    expect(out).not.toContain('and ');
  });

  it('3 unmatched: lists ALL three names comma-separated', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess',
      results: [
        { type: 'mcp', name: 'tool-alpha', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-beta', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-gamma', status: 'unmatched', catalog_id: null },
      ],
      counts: { exact: 0, fuzzy: 0, unmatched: 3 },
    };
    const out = renderSuccessSummary(body);
    expect(out).toContain('3 unmatched');
    expect(out).toContain('tool-alpha, tool-beta, tool-gamma (no catalog match — still synced)');
    expect(out).not.toContain('and ');
  });

  it('5 unmatched: shows first 3 + "and 2 more"', () => {
    const body: SyncResponseBody = {
      synced_at: '2026-04-27T12:00:00Z',
      session_id: 'sess',
      results: [
        { type: 'mcp', name: 'tool-1', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-2', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-3', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-4', status: 'unmatched', catalog_id: null },
        { type: 'mcp', name: 'tool-5', status: 'unmatched', catalog_id: null },
      ],
      counts: { exact: 0, fuzzy: 0, unmatched: 5 },
    };
    const out = renderSuccessSummary(body);
    expect(out).toContain('5 unmatched');
    expect(out).toContain('tool-1, tool-2, tool-3, and 2 more (no catalog match — still synced)');
    expect(out).not.toContain('tool-4,');
    expect(out).not.toContain('tool-5');
  });
});

describe('renderEmptyManifest (D-09)', () => {
  it('lists scanned paths', () => {
    const out = renderEmptyManifest(['/cwd/.mcp.json', '~/.claude.json']);
    expect(out).toContain('No AI tools detected');
    expect(out).toContain('/cwd/.mcp.json');
    expect(out).toContain('~/.claude.json');
    expect(out).toContain('Nothing to sync');
  });
});

describe('renderUserCodePrompt (CLI-02)', () => {
  it('prints user_code in ABCD-EFGH form and verification_uri', () => {
    const device: DeviceCodeResponse = {
      device_code: 'rawhex',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://devcat.dev/device',
      expires_in: 600,
      interval: 5,
    };
    const out = renderUserCodePrompt(device);
    expect(out).toContain('ABCD-EFGH');
    expect(out).toContain('https://devcat.dev/device');
    expect(out).toContain('10 minutes');
  });
});
