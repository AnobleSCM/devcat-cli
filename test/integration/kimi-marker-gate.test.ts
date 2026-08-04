import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end proof that the Kimi Code install-marker gate (src/manifest/
 * kimi.ts) reaches every output surface, not just the detector's return
 * value: the terminal report, --markdown, --json, and the empty-state
 * "Looked in" listing must all agree Kimi Code contributed nothing when
 * its install marker (~/.kimi-code or <cwd>/.kimi-code) is absent.
 *
 * ~/.agents/skills is the shared global install target skills.sh
 * (vercel-labs, 27k+ stars) uses for several non-Kimi tools (Cline, Warp,
 * Zed, Dexto, Loaf) — before this gate, content installed there by one of
 * THOSE tools was unconditionally attributed to Kimi Code in every one of
 * these surfaces, on a machine that may never have run Kimi at all.
 */
const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

process.env.NO_COLOR = '1';

async function runAndCapture(
  cwd: string,
  markdown: boolean,
  json = false,
): Promise<{ exitCode: number; out: string; err: string }> {
  const chunks: string[] = [];
  const errChunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      errChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  try {
    const { runReport } = await import('../../src/commands/report.js');
    const exitCode = await runReport({ markdown, json });
    return { exitCode, out: chunks.join(''), err: errChunks.join('') };
  } finally {
    writeSpy.mockRestore();
    errSpy.mockRestore();
    cwdSpy.mockRestore();
  }
}

describe('(a) skills.sh scenario — populated ~/.agents/skills, no Kimi marker, nothing else installed', () => {
  let tmpHome: string;
  let projectDir: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-empty-'));
    projectDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-empty-proj-'));
    // A skills.sh-style install for a non-Kimi tool. No .kimi-code anywhere
    // — this is the exact false-positive shape: only Kimi's scanner reads
    // this directory directly, and nothing else on this fixture machine
    // can see it.
    mkdirSync(join(tmpHome, '.agents', 'skills', 'cline-only-skill'), { recursive: true });
    writeFileSync(join(tmpHome, '.agents', 'skills', 'cline-only-skill', 'SKILL.md'), '# x\n');
    homedirHolder.current = tmpHome;
  });

  afterAll(() => {
    homedirHolder.current = null;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('produces the empty-stack report, not a phantom Kimi Code section', async () => {
    const { exitCode, out } = await runAndCapture(projectDir, false);
    expect(exitCode).toBe(0);
    expect(out).toContain('No AI tooling detected on this machine yet.');
    // No populated "Kimi Code · N tools" group heading — the empty state's
    // generic closing hint ("Add an MCP server to Claude Code, Codex, Kimi
    // Code, or Cursor...") legitimately names all four supported clients
    // regardless of what was found, so that line is not asserted against.
    expect(out).not.toMatch(/Kimi Code\s*·/);
    // Undercount-honest: the skill is truly invisible, not misattributed.
    expect(out).not.toContain('cline-only-skill');
  });

  it('the empty-state "Looked in" list omits every Kimi-only path, including ~/.agents/skills itself', async () => {
    const { out } = await runAndCapture(projectDir, false);
    expect(out).toContain('Looked in:');
    expect(out).not.toMatch(/\.kimi-code/);
    expect(out).not.toMatch(/\.agents[\\/]skills/);
  });

  it('--markdown and --json agree: no Kimi Code anywhere, and paths_checked names nothing it did not check', async () => {
    const md = await runAndCapture(projectDir, true);
    expect(md.out).toContain('No AI tooling detected on this machine yet.');
    expect(md.out).not.toContain('Kimi Code');

    const js = await runAndCapture(projectDir, false, true);
    const parsed = JSON.parse(js.out);
    expect(parsed.total).toBe(0);
    expect(parsed.clients).toEqual([]);
    expect(parsed.paths_checked.some((p: string) => p.includes('.kimi-code'))).toBe(false);
    expect(parsed.paths_checked.some((p: string) => p.includes(join('.agents', 'skills')))).toBe(false);
  });
});

describe('(a) mixed stack — a real Claude Code tool alongside the same phantom-Kimi skill', () => {
  let tmpHome: string;
  let projectDir: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-mixed-'));
    projectDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-mixed-proj-'));
    writeFileSync(join(tmpHome, '.claude.json'), JSON.stringify({ mcpServers: { github: { command: 'npx' } } }));
    mkdirSync(join(tmpHome, '.agents', 'skills', 'warp-only-skill'), { recursive: true });
    writeFileSync(join(tmpHome, '.agents', 'skills', 'warp-only-skill', 'SKILL.md'), '# x\n');
    homedirHolder.current = tmpHome;
  });

  afterAll(() => {
    homedirHolder.current = null;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('shows Claude Code but no Kimi Code section, in the terminal report, --markdown, or --json', async () => {
    const { out } = await runAndCapture(projectDir, false);
    expect(out).toContain('Your AI-coding stack — 1 tool');
    expect(out).toContain('Claude Code');
    expect(out).not.toContain('Kimi Code');
    expect(out).not.toContain('warp-only-skill');

    const md = await runAndCapture(projectDir, true);
    expect(md.out).not.toContain('### Kimi Code');

    const js = await runAndCapture(projectDir, false, true);
    const parsed = JSON.parse(js.out);
    expect(parsed.clients.map((c: { client: string }) => c.client)).toEqual(['claude-code']);
  });
});

describe('(b)/(c) marker present — Kimi Code appears normally, gated independently per scope', () => {
  let tmpHome: string;
  let projectDir: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-marker-'));
    projectDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-marker-proj-'));
    // Genuine Kimi install at BOTH scopes — the reference-machine shape.
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'global-search': { command: 'npx' } } }),
    );
    mkdirSync(join(projectDir, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(projectDir, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'repo-tool': { command: 'npx' } } }),
    );
    homedirHolder.current = tmpHome;
  });

  afterAll(() => {
    homedirHolder.current = null;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('(b) reports both the user- and project-scoped Kimi Code MCP servers, unchanged from unconditional scanning', async () => {
    const { out } = await runAndCapture(projectDir, false);
    expect(out).toContain('Kimi Code');
    expect(out).toMatch(/2 mcp\s+global-search, repo-tool/);
    expect(out).toContain('1 project-scoped · 1 user-wide');
  });

  it('(c) project-only marker still runs project scope in full when the user marker is absent', async () => {
    const bareHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-e2e-baremarker-'));
    try {
      homedirHolder.current = bareHome;
      const { out } = await runAndCapture(projectDir, false);
      expect(out).toContain('Kimi Code');
      expect(out).toMatch(/1 mcp\s+repo-tool/);
      expect(out).not.toContain('global-search');
    } finally {
      homedirHolder.current = tmpHome;
      rmSync(bareHome, { recursive: true, force: true });
    }
  });
});
