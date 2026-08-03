import { describe, it, expect } from 'vitest';
import { dedupe } from '../../../src/manifest/dedupe.js';
import type { ToolEntry } from '../../../src/manifest/index.js';

describe('dedupe', () => {
  it('returns empty array for empty input', () => {
    expect(dedupe([])).toEqual([]);
  });

  it('returns single entry untouched', () => {
    const e: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project', client: 'claude-code' };
    expect(dedupe([e])).toEqual([e]);
  });

  it('keeps first occurrence on (type, name) collision (project-first wins)', () => {
    const project: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project', client: 'claude-code' };
    const user: ToolEntry = { type: 'mcp', name: 'context7', source: 'b', scope: 'user', client: 'claude-code' };
    const result = dedupe([project, user]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(project);
  });

  it('keeps both entries when same name has different types (key is tuple)', () => {
    const mcp: ToolEntry = { type: 'mcp', name: 'shared', source: 'a', scope: 'project', client: 'claude-code' };
    const plugin: ToolEntry = { type: 'plugin', name: 'shared', source: 'b', scope: 'user', client: 'claude-code' };
    const result = dedupe([mcp, plugin]);
    expect(result).toHaveLength(2);
  });

  it('is case-sensitive on name (server-side exact match runs first)', () => {
    const lower: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project', client: 'claude-code' };
    const upper: ToolEntry = { type: 'mcp', name: 'Context7', source: 'b', scope: 'user', client: 'claude-code' };
    const result = dedupe([lower, upper]);
    expect(result).toHaveLength(2);
  });
});

describe('dedupe — canonical path identity', () => {
  function skill(name: string, canonicalPath: string, client: ToolEntry['client']): ToolEntry {
    return { type: 'skill', name, source: `/${client}/skills`, scope: 'user', client, canonicalPath };
  }

  it('collapses two DIFFERENTLY NAMED aliases of one canonical skill', () => {
    // The link-farm case where the two shelves name the same target
    // differently. (type, name) alone would let both survive.
    const viaClaude = skill('panel', '/canon/skills/panel', 'claude-code');
    const viaCodex = skill('panel-v2', '/canon/skills/panel', 'codex');

    const result = dedupe([viaClaude, viaCodex]);
    expect(result).toHaveLength(1);
    expect(result[0]!.client).toBe('claude-code');
    expect(result[0]!.name).toBe('panel');
  });

  it('keeps two DISTINCT skills that happen to share a name', () => {
    // (type, name) alone would wrongly collapse these into one.
    const claudePanel = skill('panel', '/canon/claude/panel', 'claude-code');
    const codexPanel = skill('panel', '/canon/codex/panel', 'codex');

    const result = dedupe([claudePanel, codexPanel]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.client)).toEqual(['claude-code', 'codex']);
  });

  it('falls back to (type, name) for entries with no path of their own', () => {
    // MCP servers are config keys — no canonicalPath, so name identity stands.
    const a: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project', client: 'claude-code' };
    const b: ToolEntry = { type: 'mcp', name: 'context7', source: 'b', scope: 'user', client: 'cursor' };
    expect(dedupe([a, b])).toHaveLength(1);
  });

  it('keeps one directory that is BOTH a skill and a subagent', () => {
    // A folder holding a SKILL.md and a matching <name>.md, linked into both
    // the skills root and the agents root, is legitimately two tools. Keying
    // on path alone silently dropped whichever was scanned second.
    const shared = '/canon/tldraw-offline';
    const asSkill: ToolEntry = {
      type: 'skill', name: 'tldraw-offline', source: '/claude/skills',
      scope: 'user', client: 'claude-code', canonicalPath: shared,
    };
    const asSubagent: ToolEntry = {
      type: 'subagent', name: 'tldraw-offline', source: '/claude/agents',
      scope: 'user', client: 'claude-code', canonicalPath: shared,
    };

    const result = dedupe([asSkill, asSubagent]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.type)).toEqual(['skill', 'subagent']);
  });

  it('collapses THREE aliases of one canonical skill across Claude Code, Codex, and Kimi Code', () => {
    // The shared shelf is now reachable from three harnesses: Claude Code
    // and Codex through their own link farms, Kimi Code by reading the
    // canonical directory directly. Whichever client detect() scans first
    // wins — dedupe() itself only sees three entries at one canonical path.
    const viaClaude = skill('panel', '/canon/skills/panel', 'claude-code');
    const viaCodex = skill('panel', '/canon/skills/panel', 'codex');
    const viaKimi = skill('panel', '/canon/skills/panel', 'kimi-code');

    const result = dedupe([viaClaude, viaCodex, viaKimi]);
    expect(result).toHaveLength(1);
    expect(result[0]!.client).toBe('claude-code');
  });

  it('still collapses same-path entries of the SAME type', () => {
    const shared = '/canon/panel';
    const viaClaude = skill('panel', shared, 'claude-code');
    const viaCodex = skill('panel-alias', shared, 'codex');
    expect(dedupe([viaClaude, viaCodex])).toHaveLength(1);
  });

  it('never lets a path key collide with a name key', () => {
    const pathEntry = skill('x', 'skill::x', 'claude-code');
    const nameEntry: ToolEntry = { type: 'skill', name: 'x', source: 's', scope: 'user', client: 'codex' };
    expect(dedupe([pathEntry, nameEntry])).toHaveLength(2);
  });

  it('keeps first-occurrence order regardless of which identity applied', () => {
    const entries: ToolEntry[] = [
      skill('a', '/canon/a', 'claude-code'),
      { type: 'mcp', name: 'b', source: 's', scope: 'user', client: 'codex' },
      skill('a-alias', '/canon/a', 'codex'),
      skill('c', '/canon/c', 'codex'),
    ];
    expect(dedupe(entries).map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });
});
