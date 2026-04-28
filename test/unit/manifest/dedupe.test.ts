import { describe, it, expect } from 'vitest';
import { dedupe } from '../../../src/manifest/dedupe.js';
import type { ToolEntry } from '../../../src/manifest/index.js';

describe('dedupe', () => {
  it('returns empty array for empty input', () => {
    expect(dedupe([])).toEqual([]);
  });

  it('returns single entry untouched', () => {
    const e: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project' };
    expect(dedupe([e])).toEqual([e]);
  });

  it('keeps first occurrence on (type, name) collision (project-first wins)', () => {
    const project: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project' };
    const user: ToolEntry = { type: 'mcp', name: 'context7', source: 'b', scope: 'user' };
    const result = dedupe([project, user]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(project);
  });

  it('keeps both entries when same name has different types (key is tuple)', () => {
    const mcp: ToolEntry = { type: 'mcp', name: 'shared', source: 'a', scope: 'project' };
    const plugin: ToolEntry = { type: 'plugin', name: 'shared', source: 'b', scope: 'user' };
    const result = dedupe([mcp, plugin]);
    expect(result).toHaveLength(2);
  });

  it('is case-sensitive on name (server-side exact match runs first)', () => {
    const lower: ToolEntry = { type: 'mcp', name: 'context7', source: 'a', scope: 'project' };
    const upper: ToolEntry = { type: 'mcp', name: 'Context7', source: 'b', scope: 'user' };
    const result = dedupe([lower, upper]);
    expect(result).toHaveLength(2);
  });
});
