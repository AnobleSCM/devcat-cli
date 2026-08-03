import { describe, it, expect, vi, afterEach } from 'vitest';
import type { DetectResult, ToolEntry } from '../../../src/manifest/index.js';

/**
 * report.ts colorizes through colors.ts, whose `enabled` flag is fixed at
 * module load time — so the colored path needs a fresh module graph per
 * scenario (vi.resetModules() + dynamic import), same technique as
 * colors.test.ts. report.test.ts covers everything else statically, relying
 * on isTTY being falsy in Vitest's fork pool; this file is the one place the
 * TTY-colored render itself gets exercised end to end.
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

const SAMPLE: DetectResult = {
  tools: [tool({ name: 'context7' }), tool({ name: 'swift-lsp', type: 'plugin' })],
  pathsScanned: ['/home/x/.claude.json'],
  truncations: [],
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

async function renderWith(opts: { isTTY: boolean; noColor?: string }): Promise<string> {
  process.stdout.isTTY = opts.isTTY;
  if (opts.noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = opts.noColor;
  vi.resetModules();
  const { renderStackReport } = await import('../../../src/ui/report.js');
  return renderStackReport(SAMPLE);
}

describe('renderStackReport — color hierarchy (TTY only)', () => {
  it('colorizes type labels cyan and emphasizes counts bold on a real TTY', async () => {
    const out = await renderWith({ isTTY: true });
    expect(out).toContain(`${ESC}[`);
    expect(out).toContain(`${ESC}[36mmcp`);
    expect(out).toContain(`${ESC}[36mplugin`);
    expect(out).toContain(`${ESC}[1m`);
    expect(out).toContain(`1${ESC}[22m`);
  });

  it('never colors the name list itself, only the type label and the count', async () => {
    const out = await renderWith({ isTTY: true });
    expect(out).not.toContain(`${ESC}[36mcontext7`);
    expect(out).not.toContain(`${ESC}[36mswift-lsp`);
  });

  it('colorizing never changes the underlying text — stripped output matches the plain render', async () => {
    const colored = await renderWith({ isTTY: true });
    const plain = await renderWith({ isTTY: false });
    expect(stripAnsi(colored)).toBe(plain);
  });

  it('stays fully plain when stdout is not a TTY', async () => {
    const out = await renderWith({ isTTY: false });
    expect(out).not.toContain(`${ESC}[`);
    expect(out).toContain('1 mcp');
    expect(out).toContain('1 plugin');
  });

  it('NO_COLOR forces plain output even on a TTY', async () => {
    const out = await renderWith({ isTTY: true, noColor: '1' });
    expect(out).not.toContain(`${ESC}[`);
    expect(out).toContain('1 mcp');
  });
});
