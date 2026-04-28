import isWsl from 'is-wsl';

export interface EnvFlags {
  isTTY: boolean;
  isWsl: boolean;
  hasDisplay: boolean;
  isCI: boolean;
  noColor: boolean;
}

/**
 * Detect environment flags ONCE at startup. Cache the result on the caller.
 *
 * Research Pattern 2. Combines is-wsl + DISPLAY/WAYLAND_DISPLAY env +
 * isTTY + CI env vars to decide auto-open and color stripping.
 *
 * `hasDisplay` = always true on macOS/Windows (GUI is implicit). On Linux,
 * it requires DISPLAY (X11) or WAYLAND_DISPLAY (Wayland) to be set —
 * headless SSH and Docker containers leave both unset.
 *
 * `isCI` covers GitHub Actions (`GITHUB_ACTIONS=true`), GitLab CI
 * (`CI=true`), CircleCI / Jenkins / Travis / Buildkite (all set `CI=true`).
 */
export function detectEnv(): EnvFlags {
  return {
    isTTY: !!process.stdout.isTTY,
    isWsl,
    hasDisplay:
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
    isCI:
      process.env.CI === 'true' ||
      !!process.env.GITHUB_ACTIONS ||
      !!process.env.BUILDKITE ||
      !!process.env.CIRCLECI ||
      !!process.env.JENKINS_URL,
    noColor: !!process.env.NO_COLOR,
  };
}

/**
 * Decide whether to auto-open the browser at the verification_uri.
 * D-12 default ON; --no-open suppresses; CI / non-TTY / Linux-without-DISPLAY
 * skip regardless.
 */
export function shouldAutoOpenBrowser(env: EnvFlags, userOptedOut: boolean): boolean {
  if (userOptedOut) return false;
  if (!env.isTTY) return false;
  if (env.isCI) return false;
  if (process.platform === 'linux' && !env.hasDisplay) return false;
  return true;
}

/**
 * Decide whether to emit color escape codes. NO_COLOR + isTTY discipline.
 * No --no-color flag — the env var is the standard
 * (https://no-color.org/).
 */
export function shouldUseColor(env: EnvFlags): boolean {
  if (env.noColor) return false;
  if (!env.isTTY) return false;
  return true;
}
