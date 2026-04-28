import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncRequestBody } from '../../../src/types/api.js';

/**
 * Mock holder for the homedir override. Set in beforeAll once tmpHome is
 * created; the vi.mock factory below reads through this holder so we can
 * change the value after the module is hoisted.
 *
 * vi.spyOn(os, 'homedir').mockReturnValue(...) does not work here because
 * node:os exports are non-configurable (Node ESM module-namespace contract).
 * vi.mock + importOriginal is the supported pattern.
 */
const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirHolder.current ?? actual.homedir(),
  };
});

/**
 * CLI-05 success criterion 4 (ROADMAP Phase 39):
 *   "The manifest payload sent to /api/sync contains only {type, name}
 *    tool identifiers; a test proves no env vars, file contents,
 *    absolute paths, or secret values appear in the payload even when
 *    the local settings files contain them."
 *
 * Pitfall 3 mitigation: planted secrets in the fixture tree must NEVER
 * appear in JSON.stringify(detect().tools) or in the eventual /api/sync
 * payload of {type, name} tuples.
 *
 * B2 fix: this test mocks os.homedir() so user-scope parsers (Codex,
 * Cursor, Claude user-scope) read from the fixture tree instead of the
 * real $HOME — without that mock, the user-scope assertions would be
 * vacuously true.
 */
describe('manifest-only-sync (CLI-05)', () => {
  let tmpHome: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-sec-'));

    // ─── Claude Code project-scope ─────────────────────────────────
    writeFileSync(join(tmpHome, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'context7': {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
          env: { CONTEXT7_API_KEY: 'ctx7_test_secret_proj' },
        },
        'linear-mcp': {
          command: 'node',
          args: ['/Users/test/linear-mcp/dist/index.js'],
          env: { LINEAR_API_KEY: 'lin_api_test_secret_proj' },
        },
      },
    }));

    // ─── Claude Code user-scope ────────────────────────────────────
    writeFileSync(join(tmpHome, '.claude.json'), JSON.stringify({
      mcpServers: {
        'github': {
          command: 'npx',
          args: ['-y', '@anthropic/github-mcp'],
          env: { GITHUB_TOKEN: 'ghp_test_secret_user_xxxxxxxxxxxx' },
        },
      },
    }));
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        'settings-only': {
          command: 'node',
          env: { SETTINGS_SECRET: 'settings_secret_xxxxx' },
        },
      },
    }));
    mkdirSync(join(tmpHome, '.claude', 'plugins'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'swift-lsp@claude-plugins-official': [{
          scope: 'user',
          installPath: '/Users/test/.claude/plugins/swift-lsp/',
          version: '1.0.0',
          installedAt: '2026-01-15T00:00:00Z',
          lastUpdated: '2026-01-15T00:00:00Z',
          gitCommitSha: 'abc123',
        }],
      },
    }));

    // ─── Codex user-scope (B2 fix: was vacuously absent before) ────
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'),
      '[mcp_servers.openai-tools]\n' +
      'command = "npx"\n' +
      'args = ["-y", "@openai/mcp-tools"]\n' +
      '\n' +
      '[mcp_servers.openai-tools.env]\n' +
      'OPENAI_API_KEY = "sk-test_secret_codex_user_xxxxxxxxxxxx"\n');

    // ─── Cursor user-scope (B2 fix: was vacuously absent before) ───
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    writeFileSync(join(tmpHome, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: {
        'supabase': {
          command: 'npx',
          args: ['@supabase/mcp'],
          env: { SUPABASE_ACCESS_TOKEN: 'sbp_test_secret_cursor_user' },
        },
      },
    }));

    // ─── Activate homedir override so user-scope parsers see tmpHome ─
    // (B2 fix: without this redirect, user-scope manifests would be read
    // from the test runner's real $HOME — not our planted fixtures —
    // making the user-scope assertions vacuously absent.)
    homedirHolder.current = tmpHome;
  });

  afterAll(() => {
    homedirHolder.current = null;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const FORBIDDEN_SUBSTRINGS = [
    // Project-scope Claude
    'ctx7_test_secret_proj',
    'lin_api_test_secret_proj',
    // User-scope Claude
    'ghp_test_secret_user',
    'settings_secret_xxxxx',
    // User-scope Codex (B2 fix: now ACTUALLY tested)
    'sk-test_secret_codex_user',
    // User-scope Cursor (B2 fix: now ACTUALLY tested)
    'sbp_test_secret_cursor_user',
    // Absolute paths the manifest contained in args / installPath
    '/Users/test/',
    // Env-var KEY=value patterns
    'OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'CONTEXT7_API_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'LINEAR_API_KEY',
    'SETTINGS_SECRET',
  ] as const;

  it('PRIMARY: the actual /api/sync payload {tools: [{type, name}]} has zero secret substrings', async () => {
    // W3 fix: this is the load-bearing assertion — `result.tools` includes a
    // `source` path field that's only used for --json terminal output and is
    // NEVER sent to the server. The payload going to the server is just
    // {type, name} pairs.
    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);

    // Sanity check — proves all 3 ecosystems' fixtures were loaded
    // (without this guard, an empty result.tools makes the assertion vacuous)
    expect(result.tools.length).toBeGreaterThanOrEqual(7);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('context7');     // Claude project
    expect(names).toContain('linear-mcp');   // Claude project
    expect(names).toContain('github');       // Claude user (.claude.json)
    expect(names).toContain('settings-only'); // Claude user (settings.json)
    expect(names).toContain('swift-lsp');    // Claude user (plugins, '@'-split)
    expect(names).toContain('openai-tools'); // Codex user (B2 — was missing)
    expect(names).toContain('supabase');     // Cursor user (B2 — was missing)

    // Build the exact payload shape that gets POSTed to /api/sync
    const payload: Pick<SyncRequestBody, 'tools'> = {
      tools: result.tools.map((t) => ({ type: t.type, name: t.name })),
    };
    const payloadJson = JSON.stringify(payload);

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(
        payloadJson,
        `payload contains forbidden substring: ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it('SECONDARY: the parser internal output (stripped to {type, name}) excludes secret substrings', async () => {
    // W3 secondary check: even though `source` is filesystem path metadata
    // that never reaches the server, we still want to catch any leak from
    // the parsers themselves (e.g., a parser accidentally reading env values
    // into the name field). Strip `source` (legitimate path) and check the rest.
    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);
    const stripped = result.tools.map((t) => ({ type: t.type, name: t.name }));
    const json = JSON.stringify(stripped);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('detect().tools entries have ONLY the expected keys (type, name, source, scope)', async () => {
    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);
    const ALLOWED_KEYS = new Set(['type', 'name', 'source', 'scope']);
    for (const t of result.tools) {
      for (const k of Object.keys(t)) {
        expect(ALLOWED_KEYS.has(k), `unexpected key on ToolEntry: ${k}`).toBe(true);
      }
    }
  });
});
