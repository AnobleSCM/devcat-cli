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
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-kimi-skills-'));
  homedirHolder.current = tmpHome;
});

afterEach(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('detectKimiCode — skills', () => {
  it('reads the brand root ~/.kimi-code/skills and tags entries as Kimi Code skills', async () => {
    const skillsRoot = join(tmpHome, '.kimi-code', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'demo-brand-skill');

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ scope: 'user' });

    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name)).toEqual(['demo-brand-skill']);
    expect(skills[0]!.client).toBe('kimi-code');
    expect(skills[0]!.scope).toBe('user');
    expect(result.pathsScanned).toContain(skillsRoot);
  });

  it('reads the generic root ~/.agents/skills directly (the shared shelf)', async () => {
    const skillsRoot = join(tmpHome, '.agents', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'demo-generic-skill');

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ scope: 'user' });

    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name)).toEqual(['demo-generic-skill']);
    expect(skills[0]!.client).toBe('kimi-code');
    expect(result.pathsScanned).toContain(skillsRoot);
  });

  it('merges brand and generic roots when both exist at user scope', async () => {
    makeSkill(join(tmpHome, '.kimi-code', 'skills'), 'brand-only');
    makeSkill(join(tmpHome, '.agents', 'skills'), 'generic-only');

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ scope: 'user' });

    const skills = result.tools.filter((t) => t.type === 'skill');
    expect(skills.map((t) => t.name).sort()).toEqual(['brand-only', 'generic-only']);
  });

  it('detects project-scope skills via upward walk on both roots', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'devcat-kimi-projskills-'));
    try {
      makeSkill(join(projectDir, '.kimi-code', 'skills'), 'repo-brand-skill');
      makeSkill(join(projectDir, '.agents', 'skills'), 'repo-generic-skill');

      const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
      const result = await detectKimiCode({ cwd: projectDir, scope: 'project' });

      const skills = result.tools.filter((t) => t.type === 'skill');
      expect(skills.map((t) => t.name).sort()).toEqual(['repo-brand-skill', 'repo-generic-skill']);
      expect(skills.every((t) => t.scope === 'project')).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('applies the same bounded scan: symlinks resolved, aliases and broken links collapsed', async () => {
    const canon = join(tmpHome, '.agents', 'canon-skills');
    mkdirSync(canon, { recursive: true });
    const target = makeSkill(canon, 'panel');

    const shelf = join(tmpHome, '.agents', 'skills');
    mkdirSync(shelf, { recursive: true });
    symlinkSync(target, join(shelf, 'panel'));
    symlinkSync(target, join(shelf, 'panel-alias'));
    symlinkSync(join(tmpHome, 'gone'), join(shelf, 'dangling'));
    mkdirSync(join(shelf, '.system'), { recursive: true });
    writeFileSync(join(shelf, 'AGENTS.md'), 'not a skill');

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ scope: 'user' });

    // Two aliases resolve to one target, so one entry survives.
    expect(result.tools.filter((t) => t.type === 'skill')).toHaveLength(1);
  });

  it('is silent when neither skills root exists', async () => {
    mkdirSync(join(tmpHome, '.kimi-code'), { recursive: true });
    writeFileSync(join(tmpHome, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { 'demo-search': {} } }));

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ scope: 'user' });

    expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
    expect(result.tools.map((t) => t.name)).toEqual(['demo-search']);
  });
});

describe('$HOME is not a project root — Kimi Code skills', () => {
  it('does not report ~/.agents/skills or ~/.kimi-code/skills as project-scoped', async () => {
    makeSkill(join(tmpHome, '.agents', 'skills'), 'panel');
    makeSkill(join(tmpHome, '.kimi-code', 'skills'), 'brand-skill');
    const cwd = join(tmpHome, 'Developer', 'some-repo');
    mkdirSync(cwd, { recursive: true });

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const project = await detectKimiCode({ cwd, scope: 'project' });
    expect(project.tools.filter((t) => t.type === 'skill')).toEqual([]);

    const user = await detectKimiCode({ scope: 'user' });
    expect(user.tools.filter((t) => t.type === 'skill').map((t) => t.name).sort()).toEqual([
      'brand-skill',
      'panel',
    ]);
  });

  it('does not claim the user shelf as project-scoped when cwd IS $HOME', async () => {
    makeSkill(join(tmpHome, '.agents', 'skills'), 'panel');

    const { detectKimiCode } = await import('../../../src/manifest/kimi.js');
    const result = await detectKimiCode({ cwd: tmpHome, scope: 'project' });
    expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
  });
});

describe('shared shelf — Claude Code, Codex, and Kimi Code all reach one directory', () => {
  it('lists a skill visible to all three exactly once, deterministically under Claude Code', async () => {
    // Real-world layout: ~/.claude/skills and ~/.codex/skills are link
    // farms into ~/.agents/skills. Kimi Code reads ~/.agents/skills
    // directly — no farm of its own needed to reach the same directory.
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    const shared = makeSkill(canon, 'panel');
    const claudeOnly = makeSkill(canon, 'handoff');

    const claudeFarm = join(tmpHome, '.claude', 'skills');
    mkdirSync(claudeFarm, { recursive: true });
    symlinkSync(shared, join(claudeFarm, 'panel'));
    symlinkSync(claudeOnly, join(claudeFarm, 'handoff'));

    const codexFarm = join(tmpHome, '.codex', 'skills');
    mkdirSync(codexFarm, { recursive: true });
    symlinkSync(shared, join(codexFarm, 'panel'));

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(join(tmpHome, 'nowhere'));

    const skills = result.tools.filter((t) => t.type === 'skill' && t.name === 'panel');
    expect(skills).toHaveLength(1);
    // detect() scans Claude Code before Codex before Kimi Code, so the
    // shelf entry is attributed to Claude Code regardless of how many
    // harnesses can also see it.
    expect(skills[0]!.client).toBe('claude-code');

    // A skill only Claude's farm names still shows under Claude Code.
    expect(result.tools.find((t) => t.type === 'skill' && t.name === 'handoff')!.client).toBe('claude-code');
  });

  it('a skill only Kimi Code reaches (no Claude/Codex farm entry) still appears, under Kimi Code', async () => {
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    makeSkill(canon, 'kimi-only-skill');
    // Deliberately no .claude/skills or .codex/skills farm entries at all.

    const { detect } = await import('../../../src/manifest/index.js');
    const result = await detect(join(tmpHome, 'nowhere'));

    const skill = result.tools.find((t) => t.type === 'skill' && t.name === 'kimi-only-skill');
    expect(skill).toBeDefined();
    expect(skill!.client).toBe('kimi-code');
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
      const skills = run.tools.filter((t) => t.type === 'skill' && t.name === 'panel');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.client).toBe('claude-code');
    }
  });
});
