import { CLI_VERSION } from '../version.js';

/**
 * Per Open Questions Q5: standard CLI hygiene format mirroring
 * gh / vercel / stripe.
 *
 * Returns: 'devcat-cli/0.1.0 (darwin; node v20.16.0)'
 */
export function buildUserAgent(): string {
  return `devcat-cli/${CLI_VERSION} (${process.platform}; node ${process.version})`;
}
