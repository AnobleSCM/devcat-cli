import { EXIT_GENERIC_ERROR, EXIT_AUTH_ERROR, type ExitCode } from './exitCodes.js';
import type { ErrorCode } from '../types/api.js';

/**
 * Phase 40 stable error code -> short imperative human message + exit
 * code (CONTEXT D-14 taxonomy, D-17 voice). Covers /api/sync errors
 * and device-flow errors that surface to the user.
 *
 * Voice rules (D-17):
 *   - Short imperative + action hint
 *   - Direct, technical, concise
 *   - No flourish, no exclamation marks
 *   - emoji only for ✓ / ✗ in output renderers — never inside error messages
 */

export interface MappedError {
  message: string;
  exitCode: ExitCode;
}

export function mapErrorCode(code: ErrorCode | string, fallbackMessage?: string): MappedError {
  switch (code) {
    // /api/sync errors
    case 'schema_violation':
      return {
        message: 'Manifest failed validation. Try `npx @devcat/cli sync` again or report an issue at https://github.com/AnobleSCM/devcat-cli/issues.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'rate_limit_exceeded':
      return {
        message: 'Rate-limited. Try `npx @devcat/cli sync` again in a moment.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'payload_too_large':
      return {
        message: 'Manifest exceeds the 64 KB cap. If you have hundreds of tools, split your sync or report an issue.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'idempotency_conflict':
      return {
        message: 'A previous sync is still in flight. Try `npx @devcat/cli sync` again in a moment.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'invalid_json':
    case 'invalid_request':
      return {
        message: 'Sync failed. Try `npx @devcat/cli sync` again or report an issue at https://github.com/AnobleSCM/devcat-cli/issues.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'sync_disabled':
      return {
        message: 'DevCat sync is temporarily disabled. Try again shortly.',
        exitCode: EXIT_GENERIC_ERROR,
      };
    case 'internal_error':
      return {
        message: 'DevCat server returned an error. Try `npx @devcat/cli sync` again in a moment.',
        exitCode: EXIT_GENERIC_ERROR,
      };

    // Auth errors -> exit 2
    case 'unauthorized':
    case 'token_invalid':
      return {
        message: "Session expired. Let's get you signed in again.",
        exitCode: EXIT_AUTH_ERROR,
      };
    case 'invalid_refresh_token':
      return {
        message: "Session expired. Let's get you signed in again.",
        exitCode: EXIT_AUTH_ERROR,
      };

    // Device flow errors -> exit 2
    case 'expired_token':
      return {
        message: 'Approval timed out after 10 minutes. Run `npx @devcat/cli sync` again to get a new code.',
        exitCode: EXIT_AUTH_ERROR,
      };
    case 'access_denied':
      return {
        message: 'Approval canceled. Run `npx @devcat/cli sync` again if you change your mind.',
        exitCode: EXIT_AUTH_ERROR,
      };
    case 'code_consumed':
      return {
        message: 'That device code was already used. Run `npx @devcat/cli sync` again to get a new one.',
        exitCode: EXIT_AUTH_ERROR,
      };
    case 'invalid_grant':
      return {
        message: 'Device code is invalid. Run `npx @devcat/cli sync` again.',
        exitCode: EXIT_AUTH_ERROR,
      };

    // Method/transport
    case 'method_not_allowed':
      return {
        message: 'DevCat server returned an unexpected response. Update the CLI: `npm install -g @devcat/cli@latest`.',
        exitCode: EXIT_GENERIC_ERROR,
      };

    default:
      return {
        message: fallbackMessage ?? 'Sync failed. Try `npx @devcat/cli sync` again.',
        exitCode: EXIT_GENERIC_ERROR,
      };
  }
}
