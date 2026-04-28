import pc from 'picocolors';
import { detectEnv, shouldUseColor } from '../lib/isHeadless.js';

/**
 * Color helper — picocolors auto-detects NO_COLOR + isTTY. We add an
 * explicit gate via shouldUseColor() so we can layer the --json
 * sentinel and --no-color env-var policy.
 */
const env = detectEnv();
const enabled = shouldUseColor(env);

export const c = {
  bold: (s: string): string => (enabled ? pc.bold(s) : s),
  green: (s: string): string => (enabled ? pc.green(s) : s),
  red: (s: string): string => (enabled ? pc.red(s) : s),
  yellow: (s: string): string => (enabled ? pc.yellow(s) : s),
  dim: (s: string): string => (enabled ? pc.dim(s) : s),
  cyan: (s: string): string => (enabled ? pc.cyan(s) : s),
};

export const SUCCESS_GLYPH = enabled ? pc.green('✓') : '✓';
export const FAILURE_GLYPH = enabled ? pc.red('✗') : '✗';
