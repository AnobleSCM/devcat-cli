import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * colors.ts computes its `enabled` flag once at module load time from
 * process.stdout.isTTY + NO_COLOR, so exercising both the colored and plain
 * paths in one run requires a fresh module graph per scenario:
 * vi.resetModules() then a dynamic import, after setting the env that
 * decides `enabled`. The rest of the suite relies on isTTY being falsy in
 * Vitest's fork pool (colors auto-strip); this file is where the TTY-colored
 * path itself gets exercised.
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

async function loadColors(opts: { isTTY: boolean; noColor?: string }) {
  process.stdout.isTTY = opts.isTTY;
  if (opts.noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = opts.noColor;
  vi.resetModules();
  return import('../../../src/ui/colors.js');
}

describe('colors — TTY + NO_COLOR gating', () => {
  it('emits ANSI codes on a real TTY with NO_COLOR unset', async () => {
    const { c, SUCCESS_GLYPH, FAILURE_GLYPH } = await loadColors({ isTTY: true });
    expect(c.cyan('mcp')).toContain(`${ESC}[`);
    expect(c.magenta('plugin')).toContain(`${ESC}[`);
    expect(c.green('skill')).toContain(`${ESC}[`);
    expect(c.blue('subagent')).toContain(`${ESC}[`);
    expect(c.bold('7')).toContain(`${ESC}[`);
    expect(c.dim('x')).toContain(`${ESC}[`);
    expect(SUCCESS_GLYPH).toContain(`${ESC}[`);
    expect(FAILURE_GLYPH).toContain(`${ESC}[`);
  });

  it('stays plain when stdout is not a TTY', async () => {
    const { c, SUCCESS_GLYPH, FAILURE_GLYPH } = await loadColors({ isTTY: false });
    expect(c.cyan('mcp')).toBe('mcp');
    expect(c.magenta('plugin')).toBe('plugin');
    expect(c.green('skill')).toBe('skill');
    expect(c.blue('subagent')).toBe('subagent');
    expect(c.bold('7')).toBe('7');
    expect(SUCCESS_GLYPH).toBe('✓');
    expect(FAILURE_GLYPH).toBe('✗');
  });

  it('NO_COLOR forces plain output even on a TTY', async () => {
    const { c, SUCCESS_GLYPH } = await loadColors({ isTTY: true, noColor: '1' });
    expect(c.cyan('mcp')).toBe('mcp');
    expect(c.magenta('plugin')).toBe('plugin');
    expect(c.blue('subagent')).toBe('subagent');
    expect(c.bold('7')).toBe('7');
    expect(SUCCESS_GLYPH).toBe('✓');
  });

  it('an empty-string NO_COLOR still forces plain output on a TTY', async () => {
    const { c } = await loadColors({ isTTY: true, noColor: '' });
    expect(c.cyan('mcp')).toBe('mcp');
    expect(c.magenta('plugin')).toBe('plugin');
    expect(c.blue('subagent')).toBe('subagent');
  });
});
