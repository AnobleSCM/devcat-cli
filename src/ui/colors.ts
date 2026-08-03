import pc from 'picocolors';
import { detectEnv, shouldUseColor } from '../lib/isHeadless.js';

/**
 * Color helper — picocolors auto-detects NO_COLOR + isTTY. We add an
 * explicit gate via shouldUseColor() so we can layer the --json
 * sentinel and --no-color env-var policy.
 */
const env = detectEnv();
const enabled = shouldUseColor(env);

/**
 * Only the six chromatic colors of the standard ANSI 16 are offered, and
 * white/black are deliberately absent: a terminal theme picks the background,
 * so anything at either end of the ramp is invisible on half of them. Bold and
 * dim carry emphasis instead, because they hold in every theme.
 *
 * red and yellow stay reserved for failure and truncation — the report never
 * spends them on ordinary data, so seeing one always means something.
 */
export const c = {
  bold: (s: string): string => (enabled ? pc.bold(s) : s),
  green: (s: string): string => (enabled ? pc.green(s) : s),
  red: (s: string): string => (enabled ? pc.red(s) : s),
  yellow: (s: string): string => (enabled ? pc.yellow(s) : s),
  dim: (s: string): string => (enabled ? pc.dim(s) : s),
  cyan: (s: string): string => (enabled ? pc.cyan(s) : s),
  magenta: (s: string): string => (enabled ? pc.magenta(s) : s),
  blue: (s: string): string => (enabled ? pc.blue(s) : s),
};

export const SUCCESS_GLYPH = enabled ? pc.green('✓') : '✓';
export const FAILURE_GLYPH = enabled ? pc.red('✗') : '✗';
