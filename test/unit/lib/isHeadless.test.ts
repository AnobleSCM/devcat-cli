import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectEnv, shouldAutoOpenBrowser, shouldUseColor } from '../../../src/lib/isHeadless.js';

/**
 * Tests for src/lib/isHeadless.ts.
 *
 * Note: process.platform is read-only via direct assignment but can be overridden
 * with Object.defineProperty for the duration of a test. We restore it in afterEach.
 */

const ORIGINAL_PLATFORM = process.platform;

type Platform = 'darwin' | 'linux' | 'win32' | 'aix' | 'freebsd' | 'openbsd' | 'sunos' | 'cygwin' | 'netbsd';

function setPlatform(p: Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
}

describe('detectEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    restorePlatform();
  });

  it('reads NO_COLOR env var into noColor flag', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(detectEnv().noColor).toBe(true);
    vi.stubEnv('NO_COLOR', '');
    expect(detectEnv().noColor).toBe(false);
  });

  it('detects CI from process.env.CI === "true"', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('GITHUB_ACTIONS', '');
    expect(detectEnv().isCI).toBe(true);
    vi.stubEnv('CI', '');
    expect(detectEnv().isCI).toBe(false);
  });

  it('detects CI from GITHUB_ACTIONS env var', () => {
    vi.stubEnv('CI', '');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(detectEnv().isCI).toBe(true);
  });
});

describe('shouldAutoOpenBrowser', () => {
  afterEach(() => {
    restorePlatform();
  });

  const baseEnv = {
    isTTY: true,
    isWsl: false,
    hasDisplay: true,
    isCI: false,
    noColor: false,
  };

  it('returns false when userOptedOut is true (--no-open)', () => {
    setPlatform('darwin');
    expect(shouldAutoOpenBrowser(baseEnv, true)).toBe(false);
  });

  it('returns false when not running in a TTY (piped output / CI logs)', () => {
    setPlatform('darwin');
    expect(shouldAutoOpenBrowser({ ...baseEnv, isTTY: false }, false)).toBe(false);
  });

  it('returns false when isCI flag is set', () => {
    setPlatform('darwin');
    expect(shouldAutoOpenBrowser({ ...baseEnv, isCI: true }, false)).toBe(false);
  });

  it('returns false on Linux without DISPLAY/WAYLAND_DISPLAY (headless SSH)', () => {
    setPlatform('linux');
    expect(shouldAutoOpenBrowser({ ...baseEnv, hasDisplay: false }, false)).toBe(false);
  });

  it('returns true on macOS TTY (no DISPLAY needed)', () => {
    setPlatform('darwin');
    expect(shouldAutoOpenBrowser(baseEnv, false)).toBe(true);
  });
});

describe('shouldUseColor', () => {
  it('returns false when NO_COLOR is set', () => {
    expect(shouldUseColor({
      isTTY: true, isWsl: false, hasDisplay: true, isCI: false, noColor: true,
    })).toBe(false);
  });

  it('returns false when not in a TTY', () => {
    expect(shouldUseColor({
      isTTY: false, isWsl: false, hasDisplay: true, isCI: false, noColor: false,
    })).toBe(false);
  });

  it('returns true when TTY and no NO_COLOR override', () => {
    expect(shouldUseColor({
      isTTY: true, isWsl: false, hasDisplay: true, isCI: false, noColor: false,
    })).toBe(true);
  });
});
