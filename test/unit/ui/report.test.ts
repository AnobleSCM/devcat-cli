import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  groupStack,
  renderStackReport,
  renderStackMarkdown,
  renderStackJson,
  truncationWarnings,
} from '../../../src/ui/report.js';
import type { DetectResult, ToolEntry } from '../../../src/manifest/index.js';

// Vitest fork pools leave process.stdout.isTTY undefined so colors auto-strip;
// NO_COLOR is belt-and-suspenders for any CI shape where isTTY is truthy.
process.env.NO_COLOR = '1';

// Only the home-relative-path tests below care what homedir() returns; every
// other test in this file uses fixture paths that never match a real home
// dir, so this mock is a no-op for them (same pattern as the integration
// suite's homedirHolder).
const homedirHolder: { current: string | null } = { current: null };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homedirHolder.current ?? actual.homedir() };
});

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
    tool({ name: 'deep-research', type: 'skill' }),
    tool({ name: 'code-reviewer', type: 'subagent' }),
    tool({ name: 'supabase', client: 'cursor', scope: 'project' }),
    tool({ name: 'serena', client: 'codex' }),
  ],
  pathsScanned: ['/p/.mcp.json', '~/.claude.json', '~/.codex/config.toml', '~/.cursor/mcp.json'],
  truncations: [],
};

describe('groupStack', () => {
  it('groups by client in fixed order, then by type, with names sorted', () => {
    const groups = groupStack(MIXED.tools);
    expect(groups.map((g) => g.client)).toEqual(['claude-code', 'codex', 'cursor']);
    expect(groups[0]!.label).toBe('Claude Code');
    expect(groups[0]!.total).toBe(5);
    // Type order is fixed: mcp, plugin, skill, subagent.
    expect(groups[0]!.byType).toEqual([
      { type: 'mcp', names: ['atelier-board', 'context7'] },
      { type: 'plugin', names: ['swift-lsp'] },
      { type: 'skill', names: ['deep-research'] },
      { type: 'subagent', names: ['code-reviewer'] },
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
    expect(out).toContain('Your AI-coding stack — 7 tools');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Codex');
    expect(out).toContain('Cursor');
    expect(out).toContain('atelier-board, context7');
    expect(out).toContain('swift-lsp');
    expect(out).toContain('7 tools in Claude Code, Codex, and Cursor · 4 locations checked');
  });

  it('shows a per-type count next to each type label', () => {
    const out = renderStackReport(MIXED);
    expect(out).toMatch(/2 mcp\s+atelier-board, context7/);
    expect(out).toMatch(/1 plugin\s+swift-lsp/);
    expect(out).toMatch(/1 skill\s+deep-research/);
    // 'subagent' is exactly as wide as the type column, so it still needs a gap.
    expect(out).toMatch(/1 subagent\s+code-reviewer/);
  });

  it('reports the project-scoped split only when something is project-scoped', () => {
    expect(renderStackReport(MIXED)).toContain('1 project-scoped · 6 user-wide');

    const userOnly: DetectResult = {
      tools: [tool({ name: 'a' })],
      pathsScanned: ['~/.claude.json'],
      truncations: [],
    };
    expect(renderStackReport(userOnly)).not.toContain('project-scoped');
  });

  it('wraps long name lists and indents the continuation to the name column', () => {
    const many: DetectResult = {
      tools: Array.from({ length: 20 }, (_, i) => tool({ name: `mcp-server-number-${i}` })),
      pathsScanned: ['~/.claude.json'],
      truncations: [],
    };
    const lines = renderStackReport(many).split('\n');
    const nameLines = lines.filter((l) => l.includes('mcp-server-number-'));
    expect(nameLines.length).toBeGreaterThan(1);
    for (const line of nameLines) expect(line.length).toBeLessThanOrEqual(78);
    // Every wrapped line after the first starts exactly at the name column.
    for (const line of nameLines.slice(1)) {
      expect(line.startsWith(' '.repeat(15))).toBe(true);
      expect(line[15]).not.toBe(' ');
    }
    // Wrapping must not drop or duplicate entries.
    expect(nameLines.join(' ').match(/mcp-server-number-/g)).toHaveLength(20);
  });

  it('singularizes a one-tool stack', () => {
    const one: DetectResult = {
      tools: [tool({ name: 'solo' })],
      pathsScanned: ['~/.claude.json'],
      truncations: [],
    };
    const out = renderStackReport(one);
    expect(out).toContain('Your AI-coding stack — 1 tool');
    expect(out).toContain('1 tool in Claude Code · 1 location checked');
  });

  it('empty scan: names the paths it checked instead of printing an empty stack', () => {
    const out = renderStackReport({ tools: [], pathsScanned: ['/p/.mcp.json', '~/.cursor/mcp.json'], truncations: [] });
    expect(out).toContain('No AI tooling detected on this machine yet.');
    expect(out).toContain('/p/.mcp.json');
    expect(out).toContain('~/.cursor/mcp.json');
    expect(out).not.toContain('Your AI-coding stack');
  });
});

describe('renderEmptyStack — copy and home-relative paths (terminal report only)', () => {
  const HOME = '/Users/testuser';

  beforeEach(() => {
    homedirHolder.current = HOME;
  });

  afterEach(() => {
    homedirHolder.current = null;
  });

  it('uses warm, honest, marketing-free copy', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [`${HOME}/.claude.json`], truncations: [] });
    expect(out).toContain('No AI tooling detected on this machine yet.');
  });

  it('keeps the Looked in: transparency section', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [`${HOME}/.claude.json`], truncations: [] });
    expect(out).toContain('Looked in:');
  });

  it('shows paths under $HOME as home-relative', () => {
    const out = renderStackReport({
      tools: [],
      pathsScanned: [`${HOME}/.claude.json`, `${HOME}/.claude/skills`],
      truncations: [],
    });
    expect(out).toContain('~/.claude.json');
    expect(out).toContain('~/.claude/skills');
    expect(out).not.toContain(HOME);
  });

  it('leaves paths outside $HOME absolute', () => {
    const out = renderStackReport({
      tools: [],
      pathsScanned: ['/opt/shared/.mcp.json'],
      truncations: [],
    });
    expect(out).toContain('/opt/shared/.mcp.json');
  });

  it('does not rewrite a sibling directory that merely shares the home prefix', () => {
    // /Users/testuser2 must not become ~2 from a naive (non-boundary) prefix match.
    const out = renderStackReport({
      tools: [],
      pathsScanned: [`${HOME}2/.mcp.json`],
      truncations: [],
    });
    expect(out).toContain(`${HOME}2/.mcp.json`);
  });

  it('renders the home directory itself as bare ~', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [HOME], truncations: [] });
    expect(out).toContain('  - ~');
  });

  it('does not home-relativize paths_checked in --json output', () => {
    const parsed = JSON.parse(
      renderStackJson({ tools: [], pathsScanned: [`${HOME}/.claude.json`], truncations: [] }),
    );
    expect(parsed.paths_checked).toEqual([`${HOME}/.claude.json`]);
  });
});

describe('renderStackMarkdown (--markdown)', () => {
  it('emits a "My AI stack" snippet with a section per client', () => {
    const out = renderStackMarkdown(MIXED);
    expect(out.startsWith('## My AI stack\n')).toBe(true);
    expect(out).toContain('7 tools across Claude Code, Codex, and Cursor.');
    expect(out).toContain('### Claude Code');
    expect(out).toContain('- **MCP servers (2):** `atelier-board`, `context7`');
    expect(out).toContain('- **Plugins (1):** `swift-lsp`');
    expect(out).toContain('- **Skills (1):** `deep-research`');
    expect(out).toContain('- **Subagents (1):** `code-reviewer`');
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
      truncations: [],
    };
    const bullets = renderStackMarkdown(many).split('\n').filter((l) => l.startsWith('- **'));
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain('MCP servers (20)');
  });

  it('empty scan still produces a valid snippet', () => {
    const out = renderStackMarkdown({ tools: [], pathsScanned: ['~/.claude.json'], truncations: [] });
    expect(out).toContain('## My AI stack');
    expect(out).toContain('No AI tooling detected on this machine yet.');
  });
});

describe('name sanitization', () => {
  // Config keys and folder names can legally hold control characters. A name
  // carrying an ANSI sequence would otherwise repaint the terminal report.
  const HOSTILE = '\u001b[31mred\u001b[0m\nfake-line\ttab';
  const SANITIZED = '[31mred[0mfake-linetab';
  // Every control character EXCEPT \n, which the report legitimately uses
  // to separate its own lines. Tab and ESC must not survive.
  // eslint-disable-next-line no-control-regex
  const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

  const hostile: DetectResult = {
    tools: [tool({ name: HOSTILE }), tool({ name: 'back`tick', type: 'skill' })],
    pathsScanned: ['~/.claude.json'],
    truncations: [],
  };

  it('strips control characters from the terminal report', () => {
    const out = renderStackReport(hostile);
    expect(out).not.toMatch(CONTROL_CHARS);
    expect(out).toContain(SANITIZED);
  });

  it('strips control characters and backticks from markdown', () => {
    const out = renderStackMarkdown(hostile);
    expect(out).not.toMatch(CONTROL_CHARS);
    expect(out).toContain(SANITIZED);
    // The backtick would otherwise break out of the inline code span.
    expect(out).toContain('`backtick`');
  });

  it('leaves ordinary names untouched', () => {
    expect(renderStackReport(MIXED)).toContain('atelier-board, context7');
    expect(renderStackMarkdown(MIXED)).toContain('`swift-lsp`');
  });

  it('needs no sanitizing in JSON - stringify escapes control characters', () => {
    const parsed = JSON.parse(renderStackJson(hostile));
    const names = parsed.clients.flatMap((c: { types: { names: string[] }[] }) =>
      c.types.flatMap((t) => t.names),
    );
    expect(names).toContain(HOSTILE);
  });
});

describe('truncation disclosure', () => {
  const TRUNCATED: DetectResult = {
    tools: [tool({ name: 'context7' })],
    pathsScanned: ['~/.claude/skills'],
    truncations: [
      {
        root: '~/.claude/skills',
        entriesRead: 520,
        entriesSeen: 520,
        entriesKept: 500,
        hitReadCeiling: false,
        readFailed: false,
      },
    ],
  };

  const CEILINGED: DetectResult = {
    ...TRUNCATED,
    truncations: [
      {
        root: '~/.claude/skills',
        entriesRead: 10000,
        entriesSeen: 9998,
        entriesKept: 500,
        hitReadCeiling: true,
        readFailed: false,
      },
    ],
  };

  it('the terminal report admits it is incomplete', () => {
    const out = renderStackReport(TRUNCATED);
    expect(out).toContain('1 location was truncated');
    expect(out).toContain('some tools are not listed');
  });

  it('the markdown snippet admits it too', () => {
    const out = renderStackMarkdown(TRUNCATED);
    expect(out).toContain('truncated');
    expect(out).toContain('some tools are not listed');
  });

  it('neither says anything when nothing was truncated', () => {
    expect(renderStackReport(MIXED)).not.toContain('truncated');
    expect(renderStackMarkdown(MIXED)).not.toContain('truncated');
  });

  it('JSON carries structured per-root metadata', () => {
    const parsed = JSON.parse(renderStackJson(TRUNCATED));
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncations).toEqual([
      {
        root: '~/.claude/skills',
        entries_read: 520,
        entries_seen: 520,
        entries_kept: 500,
        hit_read_ceiling: false,
        read_failed: false,
      },
    ]);
  });

  it('JSON reports truncated:false and an empty array on a clean scan', () => {
    const parsed = JSON.parse(renderStackJson(MIXED));
    expect(parsed.truncated).toBe(false);
    expect(parsed.truncations).toEqual([]);
  });

  it('the empty-state terminal report still discloses truncation', () => {
    // Early-returning on "no tools" skipped the footnote entirely, so a
    // truncated scan that found nothing claimed nothing was installed.
    const out = renderStackReport({
      tools: [],
      pathsScanned: ['~/.claude/skills'],
      truncations: TRUNCATED.truncations,
    });
    expect(out).toContain('No AI tooling detected on this machine yet.');
    expect(out).toContain('1 location was truncated');
    expect(out).toContain('some tools are not listed');
  });

  it('the empty-state markdown still discloses truncation', () => {
    const out = renderStackMarkdown({
      tools: [],
      pathsScanned: ['~/.claude/skills'],
      truncations: TRUNCATED.truncations,
    });
    expect(out).toContain('No AI tooling detected on this machine yet.');
    expect(out).toContain('truncated');
    expect(out).toContain('some tools are not listed');
  });

  it('an untruncated empty scan says nothing about truncation', () => {
    const empty = { tools: [], pathsScanned: ['~/.claude.json'], truncations: [] };
    expect(renderStackReport(empty)).not.toContain('truncated');
    expect(renderStackMarkdown(empty)).not.toContain('truncated');
  });

  it('the warning discloses a read failure rather than looking like a clean short list', () => {
    const [warning] = truncationWarnings([
      {
        root: '~/.claude/skills',
        entriesRead: 3,
        entriesSeen: 3,
        entriesKept: 3,
        hitReadCeiling: false,
        readFailed: true,
      },
    ]);
    expect(warning).toContain('reading failed after 3 entries');
    expect(warning).toContain('Some tools are not listed');
  });

  it('a dot-heavy ceiling hit reports coherent numbers', () => {
    // entriesSeen is 0 (no candidates) but the ceiling counted 10000 entries.
    // The message must not say "0 entries read" and "ceiling reached".
    const [warning] = truncationWarnings([
      {
        root: '~/.claude/skills',
        entriesRead: 10000,
        entriesSeen: 0,
        entriesKept: 0,
        hitReadCeiling: true,
        readFailed: false,
      },
    ]);
    expect(warning).toContain('after 10000 entries');
    expect(warning).not.toContain('0 entries read');
  });

  it('the stderr warning names the root and the counts', () => {
    const [warning] = truncationWarnings(TRUNCATED.truncations);
    expect(warning).toContain('~/.claude/skills');
    expect(warning).toContain('520 entries read');
    expect(warning).toContain('520 candidates, 500 examined');
    expect(warning).not.toContain('ceiling');
  });

  it('the stderr warning says so when the read ceiling was hit', () => {
    const [warning] = truncationWarnings(CEILINGED.truncations);
    expect(warning).toContain('10000-entry ceiling');
    expect(warning).toContain('More may exist unread');
  });

  it('sanitizes a hostile root path in the warning', () => {
    const [warning] = truncationWarnings([
      {
        root: 'evil\u001b[31m/skills',
        entriesRead: 600,
        entriesSeen: 600,
        entriesKept: 500,
        hitReadCeiling: false,
        readFailed: false,
      },
    ]);
    // eslint-disable-next-line no-control-regex
    expect(warning).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(warning).toContain('evil[31m/skills');
  });
});

describe('renderStackJson (--json)', () => {
  it('is a single parseable object mirroring the report', () => {
    const parsed = JSON.parse(renderStackJson(MIXED));
    expect(parsed.total).toBe(7);
    expect(parsed.project_scoped).toBe(1);
    expect(parsed.user_scoped).toBe(6);
    expect(typeof parsed.cli_version).toBe('string');
    expect(parsed.paths_checked).toEqual(MIXED.pathsScanned);
  });

  it('carries the same grouping and ordering as the terminal report', () => {
    const parsed = JSON.parse(renderStackJson(MIXED));
    expect(parsed.clients.map((c: { client: string }) => c.client)).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ]);
    const claude = parsed.clients[0];
    expect(claude.label).toBe('Claude Code');
    expect(claude.total).toBe(5);
    expect(claude.types).toEqual([
      { type: 'mcp', count: 2, names: ['atelier-board', 'context7'] },
      { type: 'plugin', count: 1, names: ['swift-lsp'] },
      { type: 'skill', count: 1, names: ['deep-research'] },
      { type: 'subagent', count: 1, names: ['code-reviewer'] },
    ]);
  });

  it('empty scan is still valid JSON with zeroed counts', () => {
    const parsed = JSON.parse(renderStackJson({ tools: [], pathsScanned: ['~/.claude.json'], truncations: [] }));
    expect(parsed.total).toBe(0);
    expect(parsed.clients).toEqual([]);
    expect(parsed.paths_checked).toEqual(['~/.claude.json']);
  });

  it('emits no ANSI even when colour is enabled', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderStackJson(MIXED)).not.toMatch(/\u001b\[/);
  });
});
