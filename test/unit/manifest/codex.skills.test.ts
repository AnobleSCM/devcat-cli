import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

let tmpHome: string;

function makeSkill(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# skill\n');
  return dir;
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-codex-skills-'));
  homedirHolder.current = tmpHome;
});

afterEach(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('detectCodex — ~/.codex/skills', () => {
  it('reads the skills root and tags entries as Codex skills', async () => {
    const skillsRoot = join(tmpHome, '.codex', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'deep-research');
    makeSkill(skillsRoot, 'panel');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const result = await detectCodex({ scope: 'user' });

    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name).sort()).toEqual(['deep-research', 'panel']);
    for (const t of skills) {
      expect(t.client).toBe('codex');
      expect(t.scope).toBe('user');
    }
    expect(result.pathsScanned).toContain(skillsRoot);
  });

  it('applies the same bounded scan: symlinks resolved, aliases and broken links collapsed', async () => {
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    const target = makeSkill(canon, 'panel');

    const farm = join(tmpHome, '.codex', 'skills');
    mkdirSync(farm, { recursive: true });
    symlinkSync(target, join(farm, 'panel'));
    symlinkSync(target, join(farm, 'panel-alias'));
    symlinkSync(join(tmpHome, 'gone'), join(farm, 'dangling'));
    mkdirSync(join(farm, '.system'), { recursive: true });
    writeFileSync(join(farm, 'AGENTS.md'), 'not a skill');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const result = await detectCodex({ scope: 'user' });

    // Two aliases resolve to one target, so one entry survives.
    expect(result.tools.filter((t) => t.type === 'skill')).toHaveLength(1);
  });

  it('reports no skills for project scope (Codex has no project skills root)', async () => {
    const skillsRoot = join(tmpHome, '.codex', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'user-only');

    const projectDir = mkdtempSync(join(tmpdir(), 'devcat-codex-proj-'));
    try {
      const { detectCodex } = await import('../../../src/manifest/codex.js');
      const result = await detectCodex({ cwd: projectDir, scope: 'project' });
      expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('is silent when the skills root does not exist', async () => {
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(join(tmpHome, '.codex', 'config.toml'), '[mcp_servers.serena]\n');

    const { detectCodex } = await import('../../../src/manifest/codex.js');
    const result = await detectCodex({ scope: 'user' });

    expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
    expect(result.tools.map((t) => t.name)).toEqual(['serena']);
  });
});

describe('shared shelf — both link farms pointing at one directory', () => {
  it('lists a skill on both shelves once, deterministically under Claude Code', async () => {
    // The real-world layout: ~/.claude/skills and ~/.codex/skills are both
    // link farms into one canonical directory.
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    const shared = makeSkill(canon, 'panel');
    const claudeOnly = makeSkill(canon, 'handoff');
    const codexOnly = makeSkill(canon, 'codex-only-skill');

    const claudeFarm = join(tmpHome, '.claude', 'skills');
    mkdirSync(claudeFarm, { recursive: true });
    symlinkSync(shared, join(claudeFarm, 'panel'));
    symlinkSync(claudeOnly, join(claudeFarm, 'handoff'));

    const codexFarm = join(tmpHome, '.codex', 'skills');
    mkdirSync(codexFarm, { recursive: true });
    symlinkSync(shared, join(codexFarm, 'panel'));
    symlinkSync(codexOnly, join(codexFarm, 'codex-only-skill'));

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(join(tmpHome, 'nowhere'));

    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name).sort()).toEqual(['codex-only-skill', 'handoff', 'panel']);

    // The shared one is listed once, under Claude Code — detect() scans
    // Claude Code before Codex, so this is stable across runs.
    const panel = skills.filter((t) => t.name === 'panel');
    expect(panel).toHaveLength(1);
    expect(panel[0]!.client).toBe('claude-code');

    // A skill only Codex provides still shows under Codex.
    expect(skills.find((t) => t.name === 'codex-only-skill')!.client).toBe('codex');
  });

  it('is stable across repeated scans', async () => {
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    const shared = makeSkill(canon, 'panel');

    const claudeFarm = join(tmpHome, '.claude', 'skills');
    mkdirSync(claudeFarm, { recursive: true });
    symlinkSync(shared, join(claudeFarm, 'panel'));
    const codexFarm = join(tmpHome, '.codex', 'skills');
    mkdirSync(codexFarm, { recursive: true });
    symlinkSync(shared, join(codexFarm, 'panel'));

    const { detect } = await import('../../../src/manifest/index.js');
    const runs = await Promise.all([
      detect(join(tmpHome, 'nowhere')),
      detect(join(tmpHome, 'nowhere')),
      detect(join(tmpHome, 'nowhere')),
    ]);
    for (const run of runs) {
      const skills = run.tools.filter((t) => t.type === 'skill');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.client).toBe('claude-code');
    }
  });
});
