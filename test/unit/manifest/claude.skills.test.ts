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
  tmpHome = mkdtempSync(join(tmpdir(), 'devcat-claude-skills-'));
  homedirHolder.current = tmpHome;
});

afterEach(() => {
  homedirHolder.current = null;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('detectClaudeCode — skills and subagents', () => {
  it('reads ~/.claude/skills and ~/.claude/agents, tagged like every other entry', async () => {
    const skillsRoot = join(tmpHome, '.claude', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'deep-research');
    makeSkill(skillsRoot, 'panel');

    const agentsRoot = join(tmpHome, '.claude', 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(agentsRoot, 'debugger.md'), 'x');

    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ scope: 'user' });

    const skills = result.tools.filter((t) => t.type === 'skill');
    const subagents = result.tools.filter((t) => t.type === 'subagent');
    expect(skills.map((t) => t.name).sort()).toEqual(['deep-research', 'panel']);
    expect(subagents.map((t) => t.name)).toEqual(['debugger']);
    for (const t of [...skills, ...subagents]) {
      expect(t.client).toBe('claude-code');
      expect(t.scope).toBe('user');
    }
    expect(result.pathsScanned).toContain(skillsRoot);
    expect(result.pathsScanned).toContain(agentsRoot);
  });

  it('resolves the symlinked link-farm layout the real shelf uses', async () => {
    const canon = join(tmpHome, '.agents', 'skills');
    mkdirSync(canon, { recursive: true });
    const target = makeSkill(canon, 'handoff');

    const farm = join(tmpHome, '.claude', 'skills');
    mkdirSync(farm, { recursive: true });
    symlinkSync(target, join(farm, 'handoff'));

    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools.filter((t) => t.type === 'skill').map((t) => t.name)).toEqual(['handoff']);
  });

  it('finds a project-scoped .claude/skills by walking up from cwd', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'devcat-claude-proj-'));
    try {
      const skillsRoot = join(projectRoot, '.claude', 'skills');
      mkdirSync(skillsRoot, { recursive: true });
      makeSkill(skillsRoot, 'repo-local-skill');
      const nested = join(projectRoot, 'src', 'deep');
      mkdirSync(nested, { recursive: true });

      const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
      const result = await detectClaudeCode({ cwd: nested, scope: 'project' });

      const skills = result.tools.filter((t) => t.type === 'skill');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('repo-local-skill');
      expect(skills[0]!.scope).toBe('project');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does NOT claim the user shelf as project-scoped when cwd sits under $HOME', async () => {
    // $HOME is an ancestor of most working directories, so an unguarded
    // upward walk would find ~/.claude/skills and label the whole shelf
    // project-scoped. The user pass already reads it.
    const skillsRoot = join(tmpHome, '.claude', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeSkill(skillsRoot, 'user-shelf-skill');
    const agentsRoot = join(tmpHome, '.claude', 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(agentsRoot, 'persona.md'), 'x');

    const cwd = join(tmpHome, 'Developer', 'some-repo');
    mkdirSync(cwd, { recursive: true });

    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ cwd, scope: 'project' });

    expect(result.tools.filter((t) => t.type === 'skill')).toEqual([]);
    expect(result.tools.filter((t) => t.type === 'subagent')).toEqual([]);
  });

  it('is silent when neither directory exists', async () => {
    const { detectClaudeCode } = await import('../../../src/manifest/claude.js');
    const result = await detectClaudeCode({ scope: 'user' });
    expect(result.tools.filter((t) => t.type === 'skill' || t.type === 'subagent')).toEqual([]);
  });
});
