import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
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

// A stored token, so runSync goes straight to the request without a device flow.
const { mockGetPassword, mockSetPassword } = vi.hoisted(() => ({
  mockGetPassword: vi.fn(),
  mockSetPassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => {
  class AsyncEntry {
    constructor(_service: string, _account: string) {}
    getPassword(): Promise<string | null> {
      return mockGetPassword();
    }
    setPassword(value: string): Promise<void> {
      return mockSetPassword(value);
    }
    deletePassword(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { AsyncEntry };
});

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

// This suite drives the live sync path on purpose — it is asserting what
// leaves the machine — so it opts past the devcat.dev-is-down pause gate.
process.env.DEVCAT_SYNC_ENABLED = '1';
process.env.NO_COLOR = '1';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let tmpHome: string;

/**
 * Run the real `devcat sync` against the fixture tree and hand back the exact
 * JSON body msw received. Nothing is reconstructed by hand: runSync detects,
 * filters, and serialises; this only observes.
 */
async function captureSyncRequest(): Promise<{ body: SyncRequestBody }> {
  let captured: SyncRequestBody | null = null;
  server.use(
    http.post('https://devcat.dev/api/sync', async ({ request }) => {
      captured = (await request.json()) as SyncRequestBody;
      return HttpResponse.json({
        synced_at: '2026-04-27T12:00:00Z',
        session_id: 'sess',
        results: [],
        counts: { exact: 0, fuzzy: 0, unmatched: 0 },
      });
    }),
  );

  mockGetPassword.mockResolvedValue(
    JSON.stringify({
      access_token: 'eyJa',
      refresh_token: 'eyJr',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
  );
  mockSetPassword.mockResolvedValue(undefined);

  const { resetTokenStoreForTests } = await import('../../../src/auth/tokenStore.js');
  resetTokenStoreForTests();

  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpHome);
  try {
    const { runSync } = await import('../../../src/commands/sync.js');
    const exitCode = await runSync({ noOpen: true });
    expect(exitCode).toBe(0);
  } finally {
    writeSpy.mockRestore();
    cwdSpy.mockRestore();
  }

  expect(captured, 'no request reached /api/sync').not.toBeNull();
  return { body: captured! };
}

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

    // ─── Skills + subagents (report-only detections) ───────────────
    mkdirSync(join(tmpHome, '.claude', 'skills', 'deep-research'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.claude', 'skills', 'deep-research', 'SKILL.md'),
      '---\nname: deep-research\n---\nEXA_API_KEY = "exa_test_secret_skill_body"\n',
    );
    mkdirSync(join(tmpHome, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.claude', 'agents', 'code-reviewer.md'),
      'GITHUB_TOKEN: ghp_test_secret_agent_body\n',
    );

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
    // Skill / subagent file bodies are never read at all — only directory
    // and file names become entries.
    'exa_test_secret_skill_body',
    'ghp_test_secret_agent_body',
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

  it('PRIMARY: the real request body sent by runSync has zero secret substrings', async () => {
    // Load-bearing assertion. Nothing here reconstructs a payload by hand:
    // runSync does its own detection and filtering, postSync serialises the
    // body, and msw hands back the exact bytes that went over the wire.
    const { body } = await captureSyncRequest();

    // Sanity check — proves all 3 ecosystems' fixtures reached the payload
    // (without this guard an empty tools array makes the assertion vacuous).
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('context7');      // Claude project
    expect(names).toContain('linear-mcp');    // Claude project
    expect(names).toContain('github');        // Claude user (.claude.json)
    expect(names).toContain('settings-only'); // Claude user (settings.json)
    expect(names).toContain('swift-lsp');     // Claude user (plugins, '@'-split)
    expect(names).toContain('openai-tools');  // Codex user
    expect(names).toContain('supabase');      // Cursor user

    const payloadJson = JSON.stringify(body);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(
        payloadJson,
        `payload contains forbidden substring: ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it('the wire payload carries ONLY manifest_hash and {type, name} tools', async () => {
    const { body } = await captureSyncRequest();

    expect(Object.keys(body).sort()).toEqual(['manifest_hash', 'tools']);
    expect(body.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    for (const entry of body.tools) {
      // No source, no scope, no client, no canonicalPath — local-only fields.
      expect(Object.keys(entry).sort()).toEqual(['name', 'type']);
    }
  });

  it('skills and subagents are detected locally but NEVER reach the wire', async () => {
    const { detect } = await import('../../../src/manifest/index.js');
    const detected = await detect(tmpHome);

    // Detected — the local report shows them.
    expect(detected.tools.filter((t) => t.type === 'skill').map((t) => t.name)).toContain(
      'deep-research',
    );
    expect(detected.tools.filter((t) => t.type === 'subagent').map((t) => t.name)).toContain(
      'code-reviewer',
    );

    // Absent from the actual request body.
    const { body } = await captureSyncRequest();
    expect(body.tools.every((t) => t.type === 'mcp' || t.type === 'plugin')).toBe(true);
    expect(body.tools.map((t) => t.name)).not.toContain('deep-research');
    expect(body.tools.map((t) => t.name)).not.toContain('code-reviewer');
    expect(JSON.stringify(body)).not.toContain('subagent');
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

  it('detect().tools entries have ONLY the expected keys (type, name, source, scope, client)', async () => {
    // `client` is a fixed literal set by the detector ('claude-code' | 'codex'
    // | 'cursor'), never a value read out of a config file. `canonicalPath` is
    // a local filesystem path used as the dedupe identity. Neither reaches the
    // server — the wire-payload test above asserts the body is {type, name}.
    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(tmpHome);
    const ALLOWED_KEYS = new Set(['type', 'name', 'source', 'scope', 'client', 'canonicalPath']);
    for (const t of result.tools) {
      for (const k of Object.keys(t)) {
        expect(ALLOWED_KEYS.has(k), `unexpected key on ToolEntry: ${k}`).toBe(true);
      }
    }
  });
});
