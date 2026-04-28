import { detect, type DetectResult } from '../manifest/index.js';
import {
  loadToken,
  saveToken,
  saveTokenInMemoryOnly,
  clearToken,
  KeychainUnavailableError,
} from '../auth/tokenStore.js';
import {
  requestDeviceCode,
  pollForToken,
  DeviceFlowExpiredError,
  UserDeniedError,
  CodeAlreadyUsedError,
  ClockDriftError,
  DeviceFlowError,
} from '../auth/deviceFlow.js';
import { refreshAccessToken, RefreshTokenInvalidError } from '../auth/refresh.js';
import {
  createSyncIdempotencyKey,
  postSync,
  TokenInvalidError,
  SyncFailedError,
  NetworkFailedError,
} from '../api/sync.js';
import { mapErrorCode, type MappedError } from '../lib/errorMap.js';
import {
  renderSuccessSummary,
  renderEmptyManifest,
  renderUserCodePrompt,
} from '../ui/render.js';
import { detectEnv, shouldAutoOpenBrowser } from '../lib/isHeadless.js';
import { openBrowser } from '../lib/openBrowser.js';
import { getVerificationHost } from '../api/types.js';
import { emitEvent, isJsonMode } from '../ui/jsonStream.js';
import {
  EXIT_OK,
  EXIT_GENERIC_ERROR,
  EXIT_AUTH_ERROR,
  type ExitCode,
} from '../lib/exitCodes.js';
import { c, FAILURE_GLYPH } from '../ui/colors.js';
import type { TokenPair } from '../types/api.js';

export interface SyncOptions {
  noOpen: boolean;
}

/**
 * Top-level `devcat sync` orchestrator.
 *
 * Order:
 *   1. detect() local manifest. Empty -> D-09 message + exit 0.
 *   2. ensureToken() — load from keychain OR auto-trigger device flow inline (D-10).
 *   3. postSync() with X-Sync-Idempotency-Key. Auto-retry on network error (D-15).
 *   4. On 401 (TokenInvalidError) -> D-16 path:
 *      a. refreshAccessToken with stored refresh_token
 *      b. on success: store new access; retry sync once
 *      c. on RefreshTokenInvalidError: clear keychain, re-trigger device flow inline, retry sync
 *   5. Render success summary (Phase 40 D-19).
 */
export async function runSync(opts: SyncOptions): Promise<ExitCode> {
  // 1. Detect manifest
  const manifest = await detect(process.cwd());
  if (manifest.tools.length === 0) {
    if (isJsonMode()) {
      emitEvent({ type: 'sync.start', tool_count: 0 });
      emitEvent({
        type: 'sync.success',
        counts: { exact: 0, fuzzy: 0, unmatched: 0 },
        paths_scanned: manifest.pathsScanned,
      });
    } else {
      process.stdout.write(renderEmptyManifest(manifest.pathsScanned) + '\n');
    }
    return EXIT_OK;
  }
  const idempotencyKey = createSyncIdempotencyKey();
  emitEvent({ type: 'sync.start', tool_count: manifest.tools.length, idempotency_key: idempotencyKey });

  // 2. Ensure token
  let tokens: TokenPair;
  try {
    const loaded = await loadToken();
    if (loaded && loaded.access_token) {
      tokens = loaded;
    } else {
      tokens = await runDeviceFlowInline(opts);
    }
  } catch (err) {
    return handleAuthSetupError(err);
  }

  // 3. Post sync — with D-16 recovery on 401
  try {
    const body = await postSync({
      accessToken: tokens.access_token,
      tools: manifest.tools,
      idempotencyKey,
      emitStartEvent: false,
    });
    if (isJsonMode()) {
      emitEvent({ type: 'sync.success', synced_at: body.synced_at, counts: body.counts });
    } else {
      process.stdout.write(renderSuccessSummary(body) + '\n');
    }
    return EXIT_OK;
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      // D-16 recovery
      return await recoverFromTokenInvalid(tokens, manifest, opts, idempotencyKey);
    }
    return handleSyncError(err);
  }
}

async function runDeviceFlowInline(opts: SyncOptions): Promise<TokenPair> {
  if (!isJsonMode()) {
    process.stdout.write(
      '\n' + c.dim("No DevCat session found, let's get you signed in.") + '\n',
    );
  }
  const device = await requestDeviceCode();
  if (!isJsonMode()) {
    process.stdout.write(renderUserCodePrompt(device));
  }

  // Browser auto-open per D-12
  const env = detectEnv();
  if (shouldAutoOpenBrowser(env, opts.noOpen)) {
    try {
      await openBrowser(device.verification_uri, getVerificationHost());
    } catch {
      // Hostname mismatch or open failure — silent fallthrough; user has the URL printed.
    }
  }

  // Poll until token or terminal error
  const ac = new AbortController();
  const tokens = await pollForToken({
    deviceCode: device.device_code,
    baseIntervalSec: device.interval,
    expiresInSec: device.expires_in,
    signal: ac.signal,
  });

  // Persist
  try {
    await saveToken(tokens);
  } catch (err) {
    if (err instanceof KeychainUnavailableError) {
      // CLI-06: print install hint, fall back to in-memory only
      if (!isJsonMode()) {
        process.stderr.write(
          c.yellow('OS keychain unavailable. Token kept in memory for this run only.') + '\n',
        );
        process.stderr.write(
          c.dim(
            'Linux install: sudo apt install libsecret-1-0 (Debian/Ubuntu) or pacman -S libsecret (Arch).',
          ) + '\n',
        );
        process.stderr.write(
          c.dim('Or set DEVCAT_TOKEN env var for headless / CI use.') + '\n',
        );
      }
      saveTokenInMemoryOnly(tokens);
    } else {
      throw err;
    }
  }

  return tokens;
}

async function recoverFromTokenInvalid(
  tokens: TokenPair,
  manifest: DetectResult,
  opts: SyncOptions,
  idempotencyKey: string,
): Promise<ExitCode> {
  let nextAccessToken: string;
  // 4a. Try refresh first
  try {
    if (!tokens.refresh_token) throw new RefreshTokenInvalidError();
    const refreshed = await refreshAccessToken({ refreshToken: tokens.refresh_token });
    const newTokens: TokenPair = {
      access_token: refreshed.access_token,
      refresh_token: tokens.refresh_token, // Phase 40 D-03: refresh response NEVER returns new refresh_token
      expires_in: refreshed.expires_in,
      token_type: refreshed.token_type,
    };
    try {
      await saveToken(newTokens);
    } catch (err) {
      if (err instanceof KeychainUnavailableError) {
        saveTokenInMemoryOnly(newTokens);
      } else {
        throw err;
      }
    }
    nextAccessToken = newTokens.access_token;
  } catch (err) {
    if (err instanceof RefreshTokenInvalidError) {
      // 4c. refresh expired or revoked — clear keychain and re-run device flow inline
      if (!isJsonMode()) {
        process.stdout.write(
          '\n' + c.dim("Session expired. Let's get you signed in again.") + '\n',
        );
      }
      await clearToken().catch(() => undefined);
      let newTokens: TokenPair;
      try {
        newTokens = await runDeviceFlowInline(opts);
      } catch (err2) {
        return handleAuthSetupError(err2);
      }
      nextAccessToken = newTokens.access_token;
    } else {
      return handleAuthSetupError(err);
    }
  }

  // 4b. Retry sync once with new access token
  try {
    const body = await postSync({
      accessToken: nextAccessToken,
      tools: manifest.tools,
      idempotencyKey,
      emitStartEvent: false,
    });
    if (isJsonMode()) {
      emitEvent({ type: 'sync.success', synced_at: body.synced_at, counts: body.counts });
    } else {
      process.stdout.write(renderSuccessSummary(body) + '\n');
    }
    return EXIT_OK;
  } catch (err) {
    return handleSyncError(err);
  }
}

function handleSyncError(err: unknown): ExitCode {
  let mapped: MappedError;
  if (err instanceof SyncFailedError) {
    mapped = mapErrorCode(err.code, err.message);
  } else if (err instanceof TokenInvalidError) {
    mapped = mapErrorCode('token_invalid');
  } else if (err instanceof NetworkFailedError) {
    mapped = {
      message: "Couldn't reach devcat.dev. Check your internet connection and try again.",
      exitCode: EXIT_GENERIC_ERROR,
    };
  } else {
    mapped = {
      message: err instanceof Error ? err.message : 'Sync failed.',
      exitCode: EXIT_GENERIC_ERROR,
    };
  }
  writeErrorOutput(mapped);
  return mapped.exitCode;
}

function handleAuthSetupError(err: unknown): ExitCode {
  let mapped: MappedError;
  if (err instanceof KeychainUnavailableError) {
    mapped = {
      message:
        'OS keychain unavailable. Linux: sudo apt install libsecret-1-0 (Debian/Ubuntu) or pacman -S libsecret (Arch). Or set DEVCAT_TOKEN env var for headless / CI use.',
      exitCode: EXIT_GENERIC_ERROR,
    };
  } else if (err instanceof DeviceFlowExpiredError) {
    mapped = mapErrorCode('expired_token');
  } else if (err instanceof UserDeniedError) {
    mapped = mapErrorCode('access_denied');
  } else if (err instanceof CodeAlreadyUsedError) {
    mapped = mapErrorCode('code_consumed');
  } else if (err instanceof ClockDriftError) {
    mapped = { message: err.message, exitCode: EXIT_AUTH_ERROR };
  } else if (err instanceof DeviceFlowError) {
    mapped = mapErrorCode(err.code, err.message);
  } else if (err instanceof RefreshTokenInvalidError) {
    mapped = mapErrorCode('invalid_refresh_token');
  } else {
    mapped = {
      message: err instanceof Error ? err.message : 'Sign-in failed.',
      exitCode: EXIT_AUTH_ERROR,
    };
  }
  writeErrorOutput(mapped);
  return mapped.exitCode;
}

function writeErrorOutput(mapped: MappedError): void {
  if (isJsonMode()) {
    emitEvent({
      type: 'sync.error',
      message: mapped.message,
      exit_code: mapped.exitCode,
    });
  } else {
    process.stderr.write(`${FAILURE_GLYPH} ${c.red(mapped.message)}\n`);
  }
}
