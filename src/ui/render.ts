import type { SyncResponseBody, DeviceCodeResponse } from '../types/api.js';
import { c, SUCCESS_GLYPH } from './colors.js';

/**
 * Phase 40 D-19 success summary — byte-for-byte locked.
 *
 * Output template (color-stripped):
 *
 *   ✓ Pushed N tools to devcat.dev
 *
 *     X matched           ready in My Tools
 *     Y matched (fuzzy)   review at https://devcat.dev/my-tools
 *     Z unmatched         <name1> (no catalog match — still synced)
 *
 *   Sync complete.
 *
 * Multi-unmatched rendering policy:
 *   - 1 unmatched:  show the single name
 *   - 2-3 unmatched: list all names comma-separated
 *   - 4+ unmatched: list first 3 names + "and N more"
 */
export function renderSuccessSummary(body: SyncResponseBody): string {
  const exact = body.counts.exact;
  const fuzzy = body.counts.fuzzy;
  const unmatched = body.counts.unmatched;
  const total = body.results.length;

  const lines: string[] = [];
  lines.push(`${SUCCESS_GLYPH} ${c.bold(`Pushed ${total} tool${total === 1 ? '' : 's'} to devcat.dev`)}`);
  lines.push('');

  if (exact > 0) {
    lines.push(`  ${pad(`${exact} matched`, 17)} ${c.dim('ready in My Tools')}`);
  }
  if (fuzzy > 0) {
    lines.push(`  ${pad(`${fuzzy} matched (fuzzy)`, 17)} ${c.dim('review at https://devcat.dev/my-tools')}`);
  }
  if (unmatched > 0) {
    // Phase 40 D-19 spirit: "Named items only for unmatched (user most likely cares)".
    const unmatchedNames = body.results
      .filter((r) => r.status === 'unmatched')
      .map((r) => r.name);
    const suffix = c.dim('(no catalog match — still synced)');
    let namedItems: string;
    if (unmatchedNames.length === 0) {
      namedItems = '';
    } else if (unmatchedNames.length <= 3) {
      namedItems = unmatchedNames.join(', ');
    } else {
      const firstThree = unmatchedNames.slice(0, 3);
      const remaining = unmatchedNames.length - 3;
      namedItems = `${firstThree.join(', ')}, and ${remaining} more`;
    }
    const detail = namedItems ? `${namedItems} ${suffix}` : suffix;
    lines.push(`  ${pad(`${unmatched} unmatched`, 17)} ${detail}`);
  }

  lines.push('');
  lines.push('Sync complete.');
  return lines.join('\n');
}

/**
 * D-09 friendly empty-manifest message. Lists the paths the CLI scanned
 * so the user can spot a missing config location.
 */
export function renderEmptyManifest(pathsScanned: string[]): string {
  const list = pathsScanned.map((p) => `  - ${p}`).join('\n');
  return `${SUCCESS_GLYPH} ${c.bold('No AI tools detected.')}\n\nLooked in:\n${list}\n\nNothing to sync.`;
}

/**
 * Phase 39 CLI-02: print user_code + verification URL. Plain by default,
 * with picocolor highlighting on the user_code itself.
 */
export function renderUserCodePrompt(device: DeviceCodeResponse): string {
  return [
    '',
    c.bold('Sign in to DevCat'),
    '',
    `  Visit:       ${c.cyan(device.verification_uri)}`,
    `  Enter code:  ${c.bold(device.user_code)}`,
    '',
    c.dim(`Code expires in ${Math.floor(device.expires_in / 60)} minutes.`),
    '',
  ].join('\n');
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}
