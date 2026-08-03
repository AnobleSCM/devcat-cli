import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sep, join } from 'node:path';
import {
  groupStack,
  renderStackReport,
  renderStackMarkdown,
  renderStackJson,
  truncationWarnings,
  toHomeRelative,
  toCwdRelative,
} from '../../../src/ui/report.js';
import { CLI_VERSION } from '../../../src/version.js';
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
  it('opens with the wordmark and version, above the result line', () => {
    // A screenshot of this report should say what produced it, and which
    // version — the report is the thing people share.
    const lines = renderStackReport(MIXED).split('\n');
    expect(lines[0]).toBe(`devcat v${CLI_VERSION}`);
    expect(lines[1]).toBe('');
    expect(lines[2]).toContain('Your AI-coding stack');
  });

  it('closes on a dim share hint naming the markdown flag', () => {
    const lines = renderStackReport(MIXED).split('\n');
    expect(lines[lines.length - 1]).toBe('Share it — npx devcat-cli --markdown');
    expect(lines[lines.length - 2]).toBe('');
  });

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

  it('draws a proportional bar in front of each count', () => {
    // MIXED's largest single type count is 2 (Claude Code's MCP servers), so
    // that row fills the bar and every 1-count row draws half of it.
    const out = renderStackReport(MIXED);
    expect(out).toContain('██████   2 mcp');
    expect(out).toContain('███      1 plugin');
    expect(out).toContain('███      1 subagent');
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
      expect(line.startsWith(' '.repeat(22))).toBe(true);
      expect(line[22]).not.toBe(' ');
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

describe('count bars — one scale for the whole report', () => {
  function stack(counts: { client: ToolEntry['client']; type: ToolEntry['type']; n: number }[]): DetectResult {
    return {
      tools: counts.flatMap(({ client, type, n }) =>
        Array.from({ length: n }, (_, i) => tool({ name: `${client}-${type}-${i}`, client, type })),
      ),
      pathsScanned: ['~/.claude.json'],
      truncations: [],
    };
  }

  /** The bar cell of every type row, in report order. */
  function bars(result: DetectResult): string[] {
    return renderStackReport(result)
      .split('\n')
      .map((l) => /^ {2}([█▌]+) /.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!);
  }

  it('scales every bar against the largest count anywhere, not per client', () => {
    // Codex's 3 MCP servers must not draw as wide as Claude Code's 12 just
    // because each is the biggest thing in its own section.
    const out = bars(
      stack([
        { client: 'claude-code', type: 'mcp', n: 12 },
        { client: 'codex', type: 'mcp', n: 3 },
      ]),
    );
    expect(out).toEqual(['██████', '█▌']);
  });

  it('keeps a half block for any nonzero count, however small its share', () => {
    // A row that exists has to be visible; 1-in-100 would otherwise round to
    // an empty bar and read as a rendering bug.
    const out = bars(
      stack([
        { client: 'claude-code', type: 'mcp', n: 100 },
        { client: 'codex', type: 'mcp', n: 1 },
      ]),
    );
    expect(out).toEqual(['██████', '▌']);
  });

  it('draws a full bar when every type has the same count', () => {
    const out = bars(
      stack([
        { client: 'claude-code', type: 'mcp', n: 4 },
        { client: 'claude-code', type: 'skill', n: 4 },
      ]),
    );
    expect(out).toEqual(['██████', '██████']);
  });

  it('never lets a bar row exceed the wrap width', () => {
    const wide = stack([{ client: 'claude-code', type: 'subagent', n: 40 }]);
    for (const line of renderStackReport(wide).split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(78);
    }
  });
});

describe('renderEmptyStack — copy and home-relative paths (terminal report only)', () => {
  // Built from node:path primitives rather than hardcoded POSIX literals:
  // toHomeRelative keys off path.sep, and a hardcoded '/' fixture silently
  // no-ops the whole boundary check on win32 (sep is '\\' there), which is
  // exactly how this suite went green on Unix while failing on Windows CI.
  const HOME = join(sep, 'Users', 'testuser');

  beforeEach(() => {
    homedirHolder.current = HOME;
  });

  afterEach(() => {
    homedirHolder.current = null;
  });

  it('uses warm, honest, marketing-free copy', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [join(HOME, '.claude.json')], truncations: [] });
    expect(out).toContain('No AI tooling detected on this machine yet.');
  });

  it('carries the same wordmark header as a full report', () => {
    const lines = renderStackReport({
      tools: [],
      pathsScanned: [join(HOME, '.claude.json')],
      truncations: [],
    }).split('\n');
    expect(lines[0]).toBe(`devcat v${CLI_VERSION}`);
    expect(lines[1]).toBe('');
  });

  it('ends on the next step rather than a share hint — there is nothing to share yet', () => {
    const lines = renderStackReport({
      tools: [],
      pathsScanned: [join(HOME, '.claude.json')],
      truncations: [],
    }).split('\n');
    expect(lines[lines.length - 1]).toBe(
      'Add an MCP server to Claude Code, Codex, or Cursor and run this again.',
    );
    expect(lines.join('\n')).not.toContain('Share it');
  });

  it('keeps the Looked in: transparency section', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [join(HOME, '.claude.json')], truncations: [] });
    expect(out).toContain('Looked in:');
  });

  it('shows paths under $HOME as home-relative', () => {
    const out = renderStackReport({
      tools: [],
      pathsScanned: [join(HOME, '.claude.json'), join(HOME, '.claude', 'skills')],
      truncations: [],
    });
    expect(out).toContain(`~${sep}.claude.json`);
    expect(out).toContain(`~${sep}.claude${sep}skills`);
    expect(out).not.toContain(HOME);
  });

  it('leaves paths outside $HOME absolute', () => {
    const outside = join(sep, 'opt', 'shared', '.mcp.json');
    const out = renderStackReport({
      tools: [],
      pathsScanned: [outside],
      truncations: [],
    });
    expect(out).toContain(outside);
  });

  it('does not rewrite a sibling directory that merely shares the home prefix', () => {
    // HOME + '2' (e.g. /Users/testuser2) must not become ~2 from a naive
    // (non-boundary) prefix match.
    const sibling = `${HOME}2${sep}.mcp.json`;
    const out = renderStackReport({
      tools: [],
      pathsScanned: [sibling],
      truncations: [],
    });
    expect(out).toContain(sibling);
  });

  it('renders the home directory itself as bare ~', () => {
    const out = renderStackReport({ tools: [], pathsScanned: [HOME], truncations: [] });
    expect(out).toContain('  - ~');
  });

  it('does not home-relativize paths_checked in --json output', () => {
    const parsed = JSON.parse(
      renderStackJson({ tools: [], pathsScanned: [join(HOME, '.claude.json')], truncations: [] }),
    );
    expect(parsed.paths_checked).toEqual([join(HOME, '.claude.json')]);
  });
});

describe('renderEmptyStack — project paths print relative to the current directory', () => {
  // Same platform-aware construction as the home-relative block: the marker
  // is `.${sep}`, so a POSIX-literal fixture would silently pass on win32
  // while asserting nothing.
  const HOME = join(sep, 'Users', 'testuser');
  const CWD = join(HOME, 'Developer', 'my-project');
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    homedirHolder.current = HOME;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(CWD);
  });

  afterEach(() => {
    homedirHolder.current = null;
    cwdSpy.mockRestore();
  });

  function lookedIn(pathsScanned: string[]): string[] {
    return renderStackReport({ tools: [], pathsScanned, truncations: [] })
      .split('\n')
      .filter((l) => l.startsWith('  - '))
      .map((l) => l.slice(4));
  }

  it('shows a scanned path under the current directory as ./-relative', () => {
    expect(lookedIn([join(CWD, '.mcp.json'), join(CWD, '.cursor', 'mcp.json')])).toEqual([
      `.${sep}.mcp.json`,
      `.${sep}.cursor${sep}mcp.json`,
    ]);
  });

  it('prefers ./ over ~/ when a path sits under both', () => {
    // The project directory is inside $HOME, so both rules match. The more
    // specific answer is the useful one.
    expect(lookedIn([join(CWD, '.mcp.json')])).toEqual([`.${sep}.mcp.json`]);
  });

  it('still prints user-wide locations home-relative', () => {
    expect(lookedIn([join(HOME, '.claude', 'skills')])).toEqual([`~${sep}.claude${sep}skills`]);
  });

  it('renders the current directory itself as bare .', () => {
    expect(lookedIn([CWD])).toEqual(['.']);
  });

  it('falls back to ~ when the current directory IS $HOME', () => {
    // `cd ~ && npx devcat-cli`: "./.claude.json" would be true and useless.
    cwdSpy.mockReturnValue(HOME);
    expect(lookedIn([join(HOME, '.claude.json')])).toEqual([`~${sep}.claude.json`]);
  });

  it('leaves a location above the current directory home-relative, not ./', () => {
    // The upward walk reaches ancestors; those are genuinely not "here".
    const ancestor = join(HOME, 'Developer', '.mcp.json');
    expect(lookedIn([ancestor])).toEqual([`~${sep}Developer${sep}.mcp.json`]);
  });
});

describe('toCwdRelative — same boundary and case rules as toHomeRelative', () => {
  const CWD = join(sep, 'srv', 'project');

  it('rewrites a path under the base directory', () => {
    expect(toCwdRelative(join(CWD, '.mcp.json'), CWD, 'sensitive')).toBe(`.${sep}.mcp.json`);
  });

  it('renders the base directory itself as bare .', () => {
    expect(toCwdRelative(CWD, CWD, 'sensitive')).toBe('.');
  });

  it('does not rewrite a sibling that merely shares the prefix', () => {
    // /srv/project2 next to /srv/project must not become ".2".
    const sibling = `${CWD}2${sep}.mcp.json`;
    expect(toCwdRelative(sibling, CWD, 'sensitive')).toBe(sibling);
  });

  it('leaves a path outside the base directory alone', () => {
    const outside = join(sep, 'opt', 'shared', '.mcp.json');
    expect(toCwdRelative(outside, CWD, 'sensitive')).toBe(outside);
  });

  it('folds case in insensitive mode and preserves the original casing after the prefix', () => {
    const shouted = `${CWD.toUpperCase()}${sep}MixedCase.JSON`;
    expect(toCwdRelative(shouted, CWD, 'insensitive')).toBe(`.${sep}MixedCase.JSON`);
    expect(toCwdRelative(shouted, CWD, 'sensitive')).toBe(shouted);
  });
});

describe('toHomeRelative — case-sensitivity policy', () => {
  // caseSensitivity is an explicit parameter precisely so these can run
  // deterministically on every CI lane instead of only asserting whatever
  // the host platform's own case-folding happens to do.
  const HOME = join(sep, 'Users', 'testuser');

  it('matches a differently-cased home prefix in insensitive mode (win32/darwin policy)', () => {
    const shouted = `${HOME.toUpperCase()}${sep}.claude.json`;
    expect(toHomeRelative(shouted, HOME, 'insensitive')).toBe(`~${sep}.claude.json`);
  });

  it('does not match a differently-cased home prefix in sensitive mode (linux policy)', () => {
    const shouted = `${HOME.toUpperCase()}${sep}.claude.json`;
    expect(toHomeRelative(shouted, HOME, 'sensitive')).toBe(shouted);
  });

  it('preserves the original path casing beyond the matched prefix', () => {
    // The comparison folds case; the output must not — only the matched
    // home-prefix span is replaced by ~, the remainder prints as scanned.
    const shouted = `${HOME.toUpperCase()}${sep}MixedCase.JSON`;
    expect(toHomeRelative(shouted, HOME, 'insensitive')).toBe(`~${sep}MixedCase.JSON`);
  });

  it('holds the sibling-directory boundary guard case-insensitively', () => {
    // home '/users/name' + path '/Users/NAME2/x' must stay absolute even
    // when folding case — NAME2 is a sibling, not home itself.
    const home = join(sep, 'users', 'name');
    const sibling = `${join(sep, 'Users', 'NAME')}2${sep}x`;
    expect(toHomeRelative(sibling, home, 'insensitive')).toBe(sibling);
  });

  it('exact-equality shortcut also folds case in insensitive mode', () => {
    expect(toHomeRelative(HOME.toUpperCase(), HOME, 'insensitive')).toBe('~');
    expect(toHomeRelative(HOME.toUpperCase(), HOME, 'sensitive')).toBe(HOME.toUpperCase());
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
