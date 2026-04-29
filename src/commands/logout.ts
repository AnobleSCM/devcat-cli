import { clearToken } from '../auth/tokenStore.js';
import { c, SUCCESS_GLYPH } from '../ui/colors.js';
import { EXIT_OK, type ExitCode } from '../lib/exitCodes.js';

/**
 * Non-interactive logout (CONTEXT D-11). Single keychain delete + one print line.
 * Idempotent — safe to run when no session exists.
 */
export async function runLogout(): Promise<ExitCode> {
  await clearToken().catch(() => undefined);
  process.stdout.write(
    `${SUCCESS_GLYPH} ${c.bold('Logged out.')} Run \`npx devcat-cli sync\` to sign back in.\n`,
  );
  return EXIT_OK;
}
