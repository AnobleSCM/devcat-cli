/**
 * Re-export Phase 40 API contract types for api/* consumers, plus
 * the API base URL resolver (DEVCAT_API_URL override).
 */
export type * from '../types/api.js';

/** Resolves the API base URL: DEVCAT_API_URL env override, else production. */
export function getApiBase(): string {
  const override = process.env.DEVCAT_API_URL;
  if (override) {
    // Sanity-check it parses as a URL with https:// scheme. Avoid http:// in prod paths.
    try {
      const url = new URL(override);
      if (url.protocol !== 'https:' && !override.startsWith('http://localhost')) {
        throw new Error(`DEVCAT_API_URL must use HTTPS: ${override}`);
      }
      // Strip trailing slash for join consistency.
      return override.replace(/\/$/, '');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('DEVCAT_API_URL must use HTTPS')) throw err;
      throw new Error(`DEVCAT_API_URL is not a valid URL: ${override}`);
    }
  }
  return 'https://devcat.dev';
}

/** Resolves expected verification host. */
export function getVerificationHost(): string {
  const base = getApiBase();
  return new URL(base).hostname;
}
