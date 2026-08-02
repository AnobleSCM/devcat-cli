import { describe, it, expect } from 'vitest';
import { groupStack, renderStackReport, renderStackMarkdown } from '../../../src/ui/report.js';
import type { DetectResult, ToolEntry } from '../../../src/manifest/index.js';

// Vitest fork pools leave process.stdout.isTTY undefined so colors auto-strip;
// NO_COLOR is belt-and-suspenders for any CI shape where isTTY is truthy.
process.env.NO_COLOR = '1';

function tool(partial: Partial<ToolEntry> & Pick<ToolEntry, 'name'>): ToolEntry {
  return {
    type: 'mcp',
    source: '/fake/path.json',
    scope: 'user',
    client: 'claude-code',
    ...partial,
  };
}

const MIXED: DetectResult = {
  tools: [
    tool({ name: 'context7' }),
    tool({ name: 'atelier-board' }),
    tool({ name: 'swift-lsp', type: 'plugin' }),
    tool({ name: 'supabase', client: 'cursor', scope: 'project' }),
    tool({ name: 'serena', client: 'codex' }),
  ],
  pathsScanned: ['/p/.mcp.json', '~/.claude.json', '~/.codex/config.toml', '~/.cursor/mcp.json'],
};

describe('groupStack', () => {
  it('groups by client in fixed order, then by type, with names sorted', () => {
    const groups = groupStack(MIXED.tools);
    expect(groups.map((g) => g.client)).toEqual(['claude-code', 'codex', 'cursor']);
    expect(groups[0]!.label).toBe('Claude Code');
    expect(groups[0]!.total).toBe(3);
    expect(groups[0]!.byType).toEqual([
      { type: 'mcp', names: ['atelier-board', 'context7'] },
      { type: 'plugin', names: ['swift-lsp'] },
    ]);
  });

  it('omits clients and types with nothing in them', () => {
    const groups = groupStack([tool({ name: 'only-one', client: 'cursor' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.client).toBe('cursor');
    expect(groups[0]!.byType).toHaveLength(1);
  });

  it('returns no groups for an empty scan', () => {
    expect(groupStack([])).toEqual([]);
  });
});

describe('renderStackReport (default `npx devcat-cli` output)', () => {
  it('prints a header, a section per client, and a totals footer', () => {
    const out = renderStackReport(MIXED);
    expect(out).toContain('Your AI-coding stack — 5 tools');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Codex');
    expect(out).toContain('Cursor');
    expect(out).toContain('atelier-board, context7');
    expect(out).toContain('swift-lsp');
    expect(out).toContain('5 tools in Claude Code, Codex, and Cursor · 4 config files checked');
  });

  it('shows a per-type count next to each type label', () => {
    const out = renderStackReport(MIXED);
    expect(out).toMatch(/2 mcp\s+atelier-board, context7/);
    expect(out).toMatch(/1 plugin\s+swift-lsp/);
  });

  it('reports the project-scoped split only when something is project-scoped', () => {
    expect(renderStackReport(MIXED)).toContain('1 project-scoped · 4 user-wide');

    const userOnly: DetectResult = {
      tools: [tool({ name: 'a' })],
      pathsScanned: ['~/.claude.json'],
    };
    expect(renderStackReport(userOnly)).not.toContain('project-scoped');
  });

  it('wraps long name lists and indents the continuation to the name column', () => {
    const many: DetectResult = {
      tools: Array.from({ length: 20 }, (_, i) => tool({ name: `mcp-server-number-${i}` })),
      pathsScanned: ['~/.claude.json'],
    };
    const lines = renderStackReport(many).split('\n');
    const nameLines = lines.filter((l) => l.includes('mcp-server-number-'));
    expect(nameLines.length).toBeGreaterThan(1);
    for (const line of nameLines) expect(line.length).toBeLessThanOrEqual(78);
    // Every wrapped line after the first starts at the name column.
    for (const line of nameLines.slice(1)) expect(line.startsWith(' '.repeat(14))).toBe(true);
    // Wrapping must not drop or duplicate entries.
    expect(nameLines.join(' ').match(/mcp-server-number-/g)).toHaveLength(20);
  });

  it('singularizes a one-tool stack', () => {
    const one: DetectResult = { tools: [tool({ name: 'solo' })], pathsScanned: ['~/.claude.json'] };
    const out = renderStackReport(one);
    expect(out).toContain('Your AI-coding stack — 1 tool');
    expect(out).toContain('1 tool in Claude Code · 1 config file checked');
  });

  it('empty scan: names the paths it checked instead of printing an empty stack', () => {
    const out = renderStackReport({ tools: [], pathsScanned: ['/p/.mcp.json', '~/.cursor/mcp.json'] });
    expect(out).toContain('No AI tooling detected.');
    expect(out).toContain('/p/.mcp.json');
    expect(out).toContain('~/.cursor/mcp.json');
    expect(out).not.toContain('Your AI-coding stack');
  });
});

describe('renderStackMarkdown (--markdown)', () => {
  it('emits a "My AI stack" snippet with a section per client', () => {
    const out = renderStackMarkdown(MIXED);
    expect(out.startsWith('## My AI stack\n')).toBe(true);
    expect(out).toContain('5 tools across Claude Code, Codex, and Cursor.');
    expect(out).toContain('### Claude Code');
    expect(out).toContain('- **MCP servers (2):** `atelier-board`, `context7`');
    expect(out).toContain('- **Plugins (1):** `swift-lsp`');
    expect(out).toContain('### Cursor');
    expect(out).toContain('devcat-cli');
  });

  it('never emits ANSI escapes — the snippet is meant to be pasted', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderStackMarkdown(MIXED)).not.toMatch(/\u001b\[/);
  });

  it('does not wrap: each type is a single markdown bullet however long', () => {
    const many: DetectResult = {
      tools: Array.from({ length: 20 }, (_, i) => tool({ name: `mcp-server-number-${i}` })),
      pathsScanned: ['~/.claude.json'],
    };
    const bullets = renderStackMarkdown(many).split('\n').filter((l) => l.startsWith('- **'));
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain('MCP servers (20)');
  });

  it('empty scan still produces a valid snippet', () => {
    const out = renderStackMarkdown({ tools: [], pathsScanned: ['~/.claude.json'] });
    expect(out).toContain('## My AI stack');
    expect(out).toContain('No AI tooling detected on this machine yet.');
  });
});
