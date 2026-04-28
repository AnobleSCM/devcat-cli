import { debugLog } from './debugLog.js';

/**
 * Open the verification URI in the user's default browser.
 *
 * Pitfall 5 mitigation: validate the hostname matches the expected host
 * BEFORE passing to open(). A malicious / compromised /api/device/request
 * response that sends a different verification_uri would otherwise open a
 * phishing page. Caller passes expectedHost (default 'devcat.dev', or
 * derived from DEVCAT_API_URL override).
 *
 * Pitfall 6 mitigation: dynamic import — `open` is ESM-only, this CLI is
 * CJS, so static `import` would fail.
 */
export async function openBrowser(verificationUri: string, expectedHost: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(verificationUri);
  } catch {
    throw new Error(`Invalid verification URI: ${verificationUri}`);
  }
  if (url.hostname !== expectedHost) {
    throw new Error(
      `Refusing to open URL: hostname '${url.hostname}' does not match expected '${expectedHost}'`,
    );
  }
  debugLog(`opening browser at ${url.host}${url.pathname}`);
  const mod = await import('open');
  const open = mod.default;
  // Fire-and-forget — open returns a child process; we never await wait.
  // Don't surface child process errors to the user; they fall back to manual paste.
  try {
    await open(verificationUri);
  } catch (err) {
    debugLog(`browser open failed (continuing): ${String(err)}`);
  }
}
