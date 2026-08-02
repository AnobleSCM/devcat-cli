import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkills, scanSubagents } from '../../../src/manifest/dirScan.js';

/**
 * These cover the filesystem-walk risk directly: the link-farm layout
 * (~/.claude/skills is entirely symlinks), broken links, aliases pointing at
 * one target, unreadable roots, and the promise that neither scan recurses.
 */
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'devcat-dirscan-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeSkill(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# skill\n');
  return dir;
}

describe('scanSkills', () => {
  it('finds directories containing SKILL.md', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    makeSkill(root, 'deep-research');
    makeSkill(root, 'panel');

    const hits = await scanSkills(root);
    expect(hits.map((h) => h.name).sort()).toEqual(['deep-research', 'panel']);
  });

  it('ignores directories without SKILL.md, loose files, and dotfiles', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    makeSkill(root, 'real-skill');
    mkdirSync(join(root, 'not-a-skill'));
    writeFileSync(join(root, 'AGENTS.md'), 'x');
    writeFileSync(join(root, 'CLAUDE.md'), 'x');
    mkdirSync(join(root, '.git'));

    const hits = await scanSkills(root);
    expect(hits.map((h) => h.name)).toEqual(['real-skill']);
  });

  it('follows symlinked skill directories (the link-farm layout)', async () => {
    const canon = join(tmp, 'canon');
    mkdirSync(canon);
    const target = makeSkill(canon, 'handoff');

    const farm = join(tmp, 'farm');
    mkdirSync(farm);
    symlinkSync(target, join(farm, 'handoff'));

    const hits = await scanSkills(farm);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe('handoff');
    // realPath resolves through the link to the canonical location.
    expect(hits[0]!.realPath).toContain('canon');
  });

  it('dedupes two aliases pointing at the same resolved path', async () => {
    const canon = join(tmp, 'canon');
    mkdirSync(canon);
    const target = makeSkill(canon, 'panel');

    const farm = join(tmp, 'farm');
    mkdirSync(farm);
    symlinkSync(target, join(farm, 'panel'));
    symlinkSync(target, join(farm, 'panel-alias'));

    const hits = await scanSkills(farm);
    expect(hits).toHaveLength(1);
  });

  it('skips broken symlinks instead of throwing', async () => {
    const farm = join(tmp, 'farm');
    mkdirSync(farm);
    makeSkill(farm, 'good');
    symlinkSync(join(tmp, 'does-not-exist'), join(farm, 'dangling'));

    const hits = await scanSkills(farm);
    expect(hits.map((h) => h.name)).toEqual(['good']);
  });

  it('does not recurse into a skill directory', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    const outer = makeSkill(root, 'outer');
    makeSkill(outer, 'nested-should-be-invisible');

    const hits = await scanSkills(root);
    expect(hits.map((h) => h.name)).toEqual(['outer']);
  });

  it('returns empty for a missing root', async () => {
    await expect(scanSkills(join(tmp, 'nope'))).resolves.toEqual([]);
  });

  it('returns empty when the root is unreadable rather than a directory', async () => {
    const file = join(tmp, 'a-file');
    writeFileSync(file, 'not a directory');
    await expect(scanSkills(file)).resolves.toEqual([]);
  });
});

describe('scanSubagents', () => {
  it('finds bare <name>.md personas', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(root);
    writeFileSync(join(root, 'tldraw-offline.md'), '---\nname: x\n---\n');

    const hits = await scanSubagents(root);
    expect(hits.map((h) => h.name)).toEqual(['tldraw-offline']);
  });

  it('finds <name>/<name>.md persona folders', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'code-reviewer'), { recursive: true });
    writeFileSync(join(root, 'code-reviewer', 'code-reviewer.md'), 'x');

    const hits = await scanSubagents(root);
    expect(hits.map((h) => h.name)).toEqual(['code-reviewer']);
  });

  it('handles both shapes in one directory, ignoring folders with no markdown', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'debugger'), { recursive: true });
    writeFileSync(join(root, 'debugger', 'debugger.md'), 'x');
    mkdirSync(join(root, 'empty-folder'));
    writeFileSync(join(root, 'secure-reviewer.md'), 'x');
    writeFileSync(join(root, 'notes.txt'), 'x');

    const hits = await scanSubagents(root);
    expect(hits.map((h) => h.name).sort()).toEqual(['debugger', 'secure-reviewer']);
  });

  it('skips broken symlinks and missing roots', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(root);
    symlinkSync(join(tmp, 'gone.md'), join(root, 'dangling.md'));

    await expect(scanSubagents(root)).resolves.toEqual([]);
    await expect(scanSubagents(join(tmp, 'nope'))).resolves.toEqual([]);
  });
});
