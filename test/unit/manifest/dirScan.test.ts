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

    const { hits } = await scanSkills(root);
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

    const { hits } = await scanSkills(root);
    expect(hits.map((h) => h.name)).toEqual(['real-skill']);
  });

  it('follows symlinked skill directories (the link-farm layout)', async () => {
    const canon = join(tmp, 'canon');
    mkdirSync(canon);
    const target = makeSkill(canon, 'handoff');

    const farm = join(tmp, 'farm');
    mkdirSync(farm);
    symlinkSync(target, join(farm, 'handoff'));

    const { hits } = await scanSkills(farm);
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

    const { hits } = await scanSkills(farm);
    expect(hits).toHaveLength(1);
  });

  it('skips broken symlinks instead of throwing', async () => {
    const farm = join(tmp, 'farm');
    mkdirSync(farm);
    makeSkill(farm, 'good');
    symlinkSync(join(tmp, 'does-not-exist'), join(farm, 'dangling'));

    const { hits } = await scanSkills(farm);
    expect(hits.map((h) => h.name)).toEqual(['good']);
  });

  it('does not recurse into a skill directory', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    const outer = makeSkill(root, 'outer');
    makeSkill(outer, 'nested-should-be-invisible');

    const { hits } = await scanSkills(root);
    expect(hits.map((h) => h.name)).toEqual(['outer']);
  });

  it('returns empty for a missing root', async () => {
    await expect(scanSkills(join(tmp, 'nope'))).resolves.toEqual({ hits: [], truncation: null });
  });

  it('returns empty when the root is unreadable rather than a directory', async () => {
    const file = join(tmp, 'a-file');
    writeFileSync(file, 'not a directory');
    await expect(scanSkills(file)).resolves.toEqual({ hits: [], truncation: null });
  });

  it('caps a large root deterministically, and says so', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    // 520 skills, over the 500 examine cap. Names are zero-padded so
    // alphabetical order is also numeric order.
    for (let i = 0; i < 520; i++) makeSkill(root, `skill-${String(i).padStart(4, '0')}`);

    const first = await scanSkills(root);
    const second = await scanSkills(root);

    expect(first.hits).toHaveLength(500);
    // Same subset every run, and it is the alphabetical head — not whatever
    // order the filesystem happened to hand back.
    expect(first.hits.map((h) => h.name)).toEqual(second.hits.map((h) => h.name));
    expect(first.hits[0]!.name).toBe('skill-0000');
    expect(first.hits[499]!.name).toBe('skill-0499');
    expect(first.hits.map((h) => h.name)).not.toContain('skill-0500');

    // The dropped 20 must be disclosed, not silently missing.
    expect(first.truncation).toEqual({
      root,
      entriesRead: 520,
      entriesSeen: 520,
      entriesKept: 500,
      hitReadCeiling: false,
      readFailed: false,
    });
  });

  it('reports no truncation when the whole root fits', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    makeSkill(root, 'only-one');
    const result = await scanSkills(root);
    expect(result.truncation).toBeNull();
  });

  it('stops reading at the ceiling and flags it, rather than draining the root', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    for (let i = 0; i < 10; i++) makeSkill(root, `skill-${String(i).padStart(2, '0')}`);

    // Ceiling of 3: iteration stops after three entries, so at most three
    // names are ever read out of a ten-entry directory.
    const result = await scanSkills(root, 3);

    expect(result.hits.length).toBeLessThanOrEqual(3);
    expect(result.truncation).not.toBeNull();
    expect(result.truncation!.hitReadCeiling).toBe(true);
    expect(result.truncation!.entriesSeen).toBeLessThanOrEqual(3);
    expect(result.truncation!.root).toBe(root);
  });

  it('counts dot-entries toward the ceiling, so a root full of them cannot spin', async () => {
    const root = join(tmp, 'skills');
    mkdirSync(root);
    for (let i = 0; i < 8; i++) mkdirSync(join(root, `.hidden-${i}`));
    makeSkill(root, 'real-skill');

    const result = await scanSkills(root, 4);
    // The ceiling was consumed by dot-entries; the scan stopped rather than
    // reading on to find the real skill, and says so.
    expect(result.truncation).not.toBeNull();
    expect(result.truncation!.hitReadCeiling).toBe(true);
  });

});

describe('scanSubagents', () => {
  it('finds bare <name>.md personas', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(root);
    writeFileSync(join(root, 'tldraw-offline.md'), '---\nname: x\n---\n');

    const { hits } = await scanSubagents(root);
    expect(hits.map((h) => h.name)).toEqual(['tldraw-offline']);
  });

  it('finds <name>/<name>.md persona folders', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'code-reviewer'), { recursive: true });
    writeFileSync(join(root, 'code-reviewer', 'code-reviewer.md'), 'x');

    const { hits } = await scanSubagents(root);
    expect(hits.map((h) => h.name)).toEqual(['code-reviewer']);
  });

  it('requires the folder name to match: reviewer/README.md is NOT subagent "reviewer"', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'reviewer'), { recursive: true });
    writeFileSync(join(root, 'reviewer', 'README.md'), '# just docs');
    writeFileSync(join(root, 'reviewer', 'notes.md'), 'x');

    const { hits } = await scanSubagents(root);
    expect(hits).toEqual([]);
  });

  it('matches the folder shape only on an exact name match', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'debugger'), { recursive: true });
    writeFileSync(join(root, 'debugger', 'debugger.md'), 'x');
    writeFileSync(join(root, 'debugger', 'README.md'), 'x');
    mkdirSync(join(root, 'impostor'), { recursive: true });
    writeFileSync(join(root, 'impostor', 'something-else.md'), 'x');

    const { hits } = await scanSubagents(root);
    expect(hits.map((h) => h.name)).toEqual(['debugger']);
  });

  it('handles both shapes in one directory, ignoring folders with no markdown', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(join(root, 'debugger'), { recursive: true });
    writeFileSync(join(root, 'debugger', 'debugger.md'), 'x');
    mkdirSync(join(root, 'empty-folder'));
    writeFileSync(join(root, 'secure-reviewer.md'), 'x');
    writeFileSync(join(root, 'notes.txt'), 'x');

    const { hits } = await scanSubagents(root);
    expect(hits.map((h) => h.name).sort()).toEqual(['debugger', 'secure-reviewer']);
  });

  it('skips broken symlinks and missing roots', async () => {
    const root = join(tmp, 'agents');
    mkdirSync(root);
    symlinkSync(join(tmp, 'gone.md'), join(root, 'dangling.md'));

    await expect((await scanSubagents(root)).hits).toEqual([]);
    await expect((await scanSubagents(join(tmp, 'nope'))).hits).toEqual([]);
  });
});
