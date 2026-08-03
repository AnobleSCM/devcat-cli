import { describe, it, expect, vi, afterEach } from 'vitest';
import type { DetectResult, ToolEntry } from '../../../src/manifest/index.js';

/**
 * report.ts colorizes through colors.ts, whose `enabled` flag is fixed at
 * module load time — so the colored path needs a fresh module graph per
 * scenario (vi.resetModules() + dynamic import), same technique as
 * colors.test.ts. report.test.ts covers everything else statically, relying
 * on isTTY being falsy in Vitest's fork pool; this file is the one place the
 * TTY-colored render itself gets exercised end to end.
 *
 * The load-bearing assertion here is the strip-invariant: ANSI-stripped
 * colored output must equal the plain render byte for byte, for every shape
 * the report can take. Color is decoration layered onto text that already
 * says everything — the moment an escape sequence carries meaning of its own,
 * `devcat > stack.txt` and a NO_COLOR terminal start lying.
 */

const ESC = String.fromCharCode(27);

const ORIGINAL_ISTTY = process.stdout.isTTY;
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

afterEach(() => {
  if (ORIGINAL_ISTTY === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY;
  else process.stdout.isTTY = ORIGINAL_ISTTY;
  if (ORIGINAL_NO_COLOR === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = ORIGINAL_NO_COLOR;
  vi.resetModules();
});

function tool(partial: Partial<ToolEntry> & Pick<ToolEntry, 'name'>): ToolEntry {
  return { type: 'mcp', source: '/fake/path.json', scope: 'user', client: 'claude-code', ...partial };
}

/** Every accented type, plus a second client, so all four colors are exercised. */
const SAMPLE: DetectResult = {
  tools: [
    tool({ name: 'context7' }),
    tool({ name: 'atelier-board' }),
    tool({ name: 'swift-lsp', type: 'plugin' }),
    tool({ name: 'deep-research', type: 'skill' }),
    tool({ name: 'code-reviewer', type: 'subagent' }),
    tool({ name: 'serena', client: 'codex', scope: 'project' }),
  ],
  pathsScanned: ['/home/x/.claude.json'],
  truncations: [],
};

/** Nothing found: masthead, the Looked in: list, and the closing next step. */
const EMPTY: DetectResult = {
  tools: [],
  pathsScanned: ['/home/x/.claude.json', '/home/x/.claude/skills'],
  truncations: [],
};

/** A scan that stopped early — the one place the report spends yellow. */
const TRUNCATED: DetectResult = {
  ...SAMPLE,
  truncations: [
    {
      root: '/home/x/.claude/skills',
      entriesRead: 520,
      entriesSeen: 520,
      entriesKept: 500,
      hitReadCeiling: false,
      readFailed: false,
    },
  ],
};

/** Strips `ESC [ ... m` SGR sequences without a control-character regex. */
function stripAnsi(s: string): string {
  let result = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === ESC && s[i + 1] === '[') {
      const end = s.indexOf('m', i);
      i = end === -1 ? s.length : end + 1;
    } else {
      result += s[i];
      i += 1;
    }
  }
  return result;
}

async function renderWith(
  opts: { isTTY: boolean; noColor?: string },
  result: DetectResult = SAMPLE,
): Promise<string> {
  process.stdout.isTTY = opts.isTTY;
  if (opts.noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = opts.noColor;
  vi.resetModules();
  const { renderStackReport } = await import('../../../src/ui/report.js');
  return renderStackReport(result);
}

describe('renderStackReport — color hierarchy (TTY only)', () => {
  it('gives each tool type its own accent, on both its bar and its label', async () => {
    const out = await renderWith({ isTTY: true });
    // 36 cyan, 35 magenta, 32 green, 34 blue — four hues of the standard
    // ANSI 16 that read on a light and a dark background.
    expect(out).toContain(`${ESC}[36m██████${ESC}[39m`);
    expect(out).toContain(`${ESC}[36mmcp`);
    expect(out).toContain(`${ESC}[35m███${ESC}[39m`);
    expect(out).toContain(`${ESC}[35mplugin`);
    expect(out).toContain(`${ESC}[32m███${ESC}[39m`);
    expect(out).toContain(`${ESC}[32mskill`);
    expect(out).toContain(`${ESC}[34m███${ESC}[39m`);
    expect(out).toContain(`${ESC}[34msubagent`);
  });

  it('spends no color on a type it does not own', async () => {
    const out = await renderWith({ isTTY: true });
    // red and yellow stay reserved for failure and truncation, so a clean
    // report must not contain either.
    expect(out).not.toContain(`${ESC}[31m`);
    expect(out).not.toContain(`${ESC}[33m`);
  });

  it('prints the wordmark bold and its version dim', async () => {
    const out = await renderWith({ isTTY: true });
    expect(out.startsWith(`${ESC}[1mdevcat${ESC}[22m ${ESC}[2mv`)).toBe(true);
  });

  it('emphasizes counts bold and keeps the success glyph green', async () => {
    const out = await renderWith({ isTTY: true });
    expect(out).toContain(`${ESC}[1m`);
    expect(out).toContain(`2${ESC}[22m`);
    expect(out).toContain(`${ESC}[32m✓${ESC}[39m`);
  });

  it('dims the share hint so it sits under the result', async () => {
    const out = await renderWith({ isTTY: true });
    expect(out).toContain(`${ESC}[2mShare it — npx devcat-cli --markdown${ESC}[22m`);
  });

  it('never colors the name list itself, only the bar, the label and the count', async () => {
    const out = await renderWith({ isTTY: true });
    for (const name of ['context7', 'swift-lsp', 'deep-research', 'code-reviewer', 'serena']) {
      for (const code of ['36', '35', '32', '34']) {
        expect(out).not.toContain(`${ESC}[${code}m${name}`);
      }
    }
  });

  it('spends yellow only on the truncation footnote', async () => {
    const out = await renderWith({ isTTY: true }, TRUNCATED);
    expect(out).toContain(`${ESC}[33m!`);
  });
});

describe('renderStackReport — strip-invariant', () => {
  // One case per shape the report can take. Any new colored element has to
  // appear in one of these renders, or it is not covered.
  const shapes: [string, DetectResult][] = [
    ['a populated stack', SAMPLE],
    ['an empty stack', EMPTY],
    ['a truncated scan', TRUNCATED],
  ];

  for (const [label, result] of shapes) {
    it(`colorizing never changes the underlying text — ${label}`, async () => {
      const colored = await renderWith({ isTTY: true }, result);
      const plain = await renderWith({ isTTY: false }, result);
      expect(colored).toContain(`${ESC}[`);
      expect(stripAnsi(colored)).toBe(plain);
    });

    it(`stays fully plain when stdout is not a TTY — ${label}`, async () => {
      const out = await renderWith({ isTTY: false }, result);
      expect(out).not.toContain(`${ESC}[`);
    });

    it(`NO_COLOR forces plain output even on a TTY — ${label}`, async () => {
      const out = await renderWith({ isTTY: true, noColor: '1' }, result);
      expect(out).not.toContain(`${ESC}[`);
      expect(out).toBe(await renderWith({ isTTY: false }, result));
    });

    it(`an empty-string NO_COLOR forces plain output too — ${label}`, async () => {
      // no-color.org disables on presence, not truthiness.
      const out = await renderWith({ isTTY: true, noColor: '' }, result);
      expect(out).not.toContain(`${ESC}[`);
      expect(out).toBe(await renderWith({ isTTY: false }, result));
    });
  }

  it('the plain render still carries every element the colored one does', async () => {
    // Color is never the only signal: bars are lengths, types are words.
    const out = await renderWith({ isTTY: false });
    expect(out).toContain('devcat v');
    expect(out).toContain('2 mcp');
    expect(out).toContain('1 plugin');
    expect(out).toContain('1 skill');
    expect(out).toContain('1 subagent');
    expect(out).toContain('██████');
    expect(out).toContain('Share it — npx devcat-cli --markdown');
  });
});
