import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectKimiCode } from '../../../src/manifest/kimi.js';

/**
 * The install-marker gate: detectKimiCode() must contribute nothing — no
 * tools, no scanned paths — unless a genuine Kimi Code install marker
 * exists for that scope (~/.kimi-code for user, <cwd>/.kimi-code for
 * project, each checked independently).
 *
 * Why this exists: ~/.agents/skills is the shared global install target
 * skills.sh (vercel-labs, 27k+ stars) uses for several non-Kimi tools
 * (Cline, Warp, Zed, Dexto, Loaf). Before this gate, content installed
 * there by one of those tools was unconditionally attributed to Kimi
 * Code, regardless of whether Kimi was ever installed on the machine.
 * See kimi.test.ts and kimi.skills.test.ts for coverage of the scanning
 * logic this gate sits in front of.
 */
const homedirHolder: { current: string | null } = { current: null };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

describe('detectKimiCode — install-marker gate', () => {
  let tmpHome: string | null = null;
  let tmpProject: string | null = null;

  beforeEach(() => {
    homedirHolder.current = null;
  });

  afterEach(() => {
    homedirHolder.current = null;
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = null;
    }
    if (tmpProject) {
      rmSync(tmpProject, { recursive: true, force: true });
      tmpProject = null;
    }
  });

  it('(a) user scope: no ~/.kimi-code marker means zero contribution, even with a populated ~/.agents/skills', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-user-'));
    homedirHolder.current = tmpHome;
    // skills.sh-style install for a non-Kimi tool — no .kimi-code anywhere.
    mkdirSync(join(tmpHome, '.agents', 'skills', 'some-skill'), { recursive: true });
    writeFileSync(join(tmpHome, '.agents', 'skills', 'some-skill', 'SKILL.md'), '# some-skill\n');

    const result = await detectKimiCode({ scope: 'user' });

    expect(result.tools).toEqual([]);
    // Not scanned means not scanned: no path is reported as looked-at.
    expect(result.pathsScanned).toEqual([]);
  });

  it('(a) project scope: no <cwd>/.kimi-code marker means zero contribution, even with a populated <cwd>/.agents/skills', async () => {
    tmpProject = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-proj-'));
    mkdirSync(join(tmpProject, '.agents', 'skills', 'some-skill'), { recursive: true });
    writeFileSync(join(tmpProject, '.agents', 'skills', 'some-skill', 'SKILL.md'), '# some-skill\n');

    const result = await detectKimiCode({ cwd: tmpProject, scope: 'project' });

    expect(result.tools).toEqual([]);
    expect(result.pathsScanned).toEqual([]);
  });

  it('user scope: a bare ~/.kimi-code marker (nothing inside it yet) still opens the gate and reports the normal locations', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-user-marker-'));
    homedirHolder.current = tmpHome;
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });

    const result = await detectKimiCode({ scope: 'user' });

    expect(result.tools).toEqual([]);
    expect(result.pathsScanned).toEqual([
      join(tmpHome, '.kimi-code', 'mcp.json'),
      join(tmpHome, '.kimi-code', 'skills'),
      join(tmpHome, '.agents', 'skills'),
    ]);
  });

  it('(c) project-only marker: project scope runs normally while user scope, with no marker of its own, stays empty', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-nouserm-'));
    homedirHolder.current = tmpHome;
    tmpProject = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-projm-'));
    mkdirSync(join(tmpProject, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'repo-only': { command: 'npx' } } }),
    );

    const project = await detectKimiCode({ cwd: tmpProject, scope: 'project' });
    expect(project.tools).toHaveLength(1);
    expect(project.tools[0]).toMatchObject({ type: 'mcp', name: 'repo-only', scope: 'project', client: 'kimi-code' });

    const user = await detectKimiCode({ scope: 'user' });
    expect(user.tools).toEqual([]);
    expect(user.pathsScanned).toEqual([]);
  });

  it('user-only marker: user scope runs normally while project scope, with no marker of its own, stays empty', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-userm-'));
    homedirHolder.current = tmpHome;
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'global-only': { command: 'npx' } } }),
    );
    tmpProject = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-noprojm-'));

    const user = await detectKimiCode({ scope: 'user' });
    expect(user.tools).toHaveLength(1);
    expect(user.tools[0]).toMatchObject({ type: 'mcp', name: 'global-only', scope: 'user', client: 'kimi-code' });

    const project = await detectKimiCode({ cwd: tmpProject, scope: 'project' });
    expect(project.tools).toEqual([]);
    expect(project.pathsScanned).toEqual([]);
  });

  it('(d) paths_checked reflects exactly what ran: same fixture, marker toggled mid-test, only the gated paths change', async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-gate-toggle-'));
    homedirHolder.current = tmpHome;
    mkdirSync(join(tmpHome, '.agents', 'skills', 'shared-tool-skill'), { recursive: true });
    writeFileSync(join(tmpHome, '.agents', 'skills', 'shared-tool-skill', 'SKILL.md'), '# shared\n');

    const withoutMarker = await detectKimiCode({ scope: 'user' });
    expect(withoutMarker.tools).toEqual([]);
    expect(withoutMarker.pathsScanned).toEqual([]);

    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    const withMarker = await detectKimiCode({ scope: 'user' });
    expect(withMarker.pathsScanned).toEqual([
      join(tmpHome, '.kimi-code', 'mcp.json'),
      join(tmpHome, '.kimi-code', 'skills'),
      join(tmpHome, '.agents', 'skills'),
    ]);
    // The shared skill is real, and on a machine that genuinely has Kimi
    // installed it IS Kimi's to report — only the no-marker attribution
    // was the bug, not the with-marker one.
    expect(withMarker.tools.map((t) => t.name)).toContain('shared-tool-skill');
  });
});
