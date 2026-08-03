import { homedir } from 'node:os';
import { sep } from 'node:path';
import type { DetectResult, ToolEntry, ToolClient, RootTruncation } from '../manifest/index.js';
import { READ_CEILING } from '../manifest/index.js';
import { CLI_VERSION } from '../version.js';
import { c, SUCCESS_GLYPH } from './colors.js';

/**
 * Local stack report — the default `npx devcat-cli` output.
 *
 * Pure renderers over a DetectResult. No network, no auth, no side effects:
 * everything here is a string transform so the shape can be byte-asserted
 * in tests.
 *
 * Two output modes:
 *   renderStackReport()   — grouped terminal report (colorized when the
 *                           terminal allows it)
 *   renderStackMarkdown() — a "My AI stack" snippet for a README or gist
 *                           (never colorized — it is meant to be pasted)
 */

/** Fixed display order so two runs on the same machine print identically. */
const CLIENT_ORDER: readonly ToolClient[] = ['claude-code', 'codex', 'cursor'];

const CLIENT_LABEL: Record<ToolClient, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

type ToolType = ToolEntry['type'];

const TYPE_ORDER: readonly ToolType[] = ['mcp', 'plugin', 'skill', 'subagent'];

const TYPE_LABEL_MARKDOWN: Record<ToolType, string> = {
  mcp: 'MCP servers',
  plugin: 'Plugins',
  skill: 'Skills',
  subagent: 'Subagents',
};

/**
 * One accent per tool type, used for both the type label and its count bar so
 * the two always agree. Drawn from the standard ANSI 16 (see colors.ts): each
 * of these four reads on a light and a dark background, which `white`, `black`
 * and `yellow` do not.
 *
 * Color is never the only signal — every row still spells its type out, and
 * every bar is a length as well as a hue — so the report survives NO_COLOR, a
 * pipe, and a reader who cannot distinguish two of the four.
 */
const TYPE_ACCENT: Record<ToolType, (s: string) => string> = {
  mcp: c.cyan,
  plugin: c.magenta,
  skill: c.green,
  subagent: c.blue,
};

/** Total line width the terminal report wraps to. */
const WRAP_WIDTH = 78;
/** Width of the type label column — one wider than the longest type name. */
const TYPE_WIDTH = 9;
/** Indent of every type row under its client heading. */
const ROW_INDENT = 2;
/** Cells in the proportional count bar. Full block = one cell, half block = a half. */
const BAR_WIDTH = 6;
/**
 * Minimum width of the count column, right-aligned. A report whose biggest
 * count needs more digits widens the column rather than overflowing it — a
 * four-digit count in a three-wide column would push that one row's label and
 * names a character right of every other row, and out of line with its own
 * wrapped continuation.
 */
const MIN_COUNT_WIDTH = 3;

/**
 * Column where the comma-separated names start (and continuation lines indent
 * to). Derived from the columns before it — indent, bar, gap, count, gap,
 * label — so widening any of them cannot silently break the alignment.
 */
function nameColumn(countWidth: number): number {
  return ROW_INDENT + BAR_WIDTH + 1 + countWidth + 1 + TYPE_WIDTH;
}

/**
 * Both blocks are in CP437, so they render even in a legacy Windows console
 * with a raster font — unlike the finer eighth-blocks (U+2589-U+258F), which
 * are not.
 */
const BAR_FULL = '█';
const BAR_HALF = '▌';

/**
 * A count as a bar, scaled against the largest single type count anywhere in
 * the report — not the largest within its own client. Local scaling would draw
 * Codex's 3 MCP servers as wide as Claude Code's 12, which is the one thing a
 * bar chart must never do.
 *
 * Any nonzero count keeps at least a half block: a row that exists must be
 * visible, however it compares to the biggest one.
 */
function renderBar(count: number, max: number): string {
  if (count <= 0 || max <= 0) return '';
  const cells = Math.max(0.5, Math.round((count / max) * BAR_WIDTH * 2) / 2);
  const full = Math.floor(cells);
  return `${BAR_FULL.repeat(full)}${cells > full ? BAR_HALF : ''}`;
}

export interface StackTypeGroup {
  type: ToolType;
  names: string[];
}

export interface StackGroup {
  client: ToolClient;
  label: string;
  total: number;
  byType: StackTypeGroup[];
}

/**
 * Names come from config keys and folder names, both of which can legally
 * contain control characters, ANSI escapes, and newlines. Rendering those
 * straight into a terminal lets a directory name repaint the report; the
 * JSON path is already safe because JSON.stringify escapes them.
 *
 * Control characters are dropped for every text rendering. Backticks are
 * additionally dropped in markdown, where they would break out of the inline
 * code span the name is wrapped in.
 */
function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

function sanitizeMarkdownName(name: string): string {
  return sanitizeName(name).replace(/`/g, '');
}

/** Whether the home-prefix comparison in {@link toHomeRelative} folds case. */
export type PathCaseSensitivity = 'sensitive' | 'insensitive';

/**
 * win32 and macOS both default to case-insensitive (but case-preserving)
 * filesystems, so a homedir() or $HOME that is cased differently from a
 * scanned path can still name the same directory. Linux filesystems are
 * case-sensitive, so a cased difference there is a genuinely different path.
 */
function defaultPathCaseSensitivity(platform: NodeJS.Platform = process.platform): PathCaseSensitivity {
  return platform === 'win32' || platform === 'darwin' ? 'insensitive' : 'sensitive';
}

/**
 * Display-only: rewrite a path under `home` to start with `~`. Requires a
 * separator (or exact equality) at the boundary so a sibling directory that
 * merely shares the prefix — /Users/name2 next to /Users/name — is left
 * absolute rather than mangled into ~2.
 *
 * The prefix comparison is case-insensitive on win32/darwin and
 * case-sensitive elsewhere (see {@link defaultPathCaseSensitivity}) — this
 * is a policy about matching, not about display: casing is folded only to
 * decide whether `path` sits under `home`, never to build the return value.
 * The output always keeps `path`'s original casing; the matched prefix span
 * is simply discarded in favor of `~`, not re-cased. `caseSensitivity`
 * defaults to the real platform policy but is an explicit parameter so tests
 * can exercise both modes deterministically regardless of which OS actually
 * runs them.
 */
export function toHomeRelative(
  path: string,
  home: string,
  caseSensitivity: PathCaseSensitivity = defaultPathCaseSensitivity(),
): string {
  return toPrefixRelative(path, home, '~', caseSensitivity);
}

/**
 * Display-only: rewrite a path under `cwd` to start with `.`, so a project
 * config reads as `.${sep}.mcp.json` rather than as the machine-specific
 * absolute path it was resolved from. Same boundary and case rules as
 * {@link toHomeRelative} — a sibling directory sharing the prefix stays
 * absolute.
 *
 * The marker is `.${sep}`, not a hardcoded `./`: on win32 the idiomatic
 * relative form is `.\`, and mixing separators in one printed path is how a
 * report starts looking machine-generated.
 */
export function toCwdRelative(
  path: string,
  cwd: string,
  caseSensitivity: PathCaseSensitivity = defaultPathCaseSensitivity(),
): string {
  return toPrefixRelative(path, cwd, '.', caseSensitivity);
}

function fold(s: string, caseSensitivity: PathCaseSensitivity): string {
  return caseSensitivity === 'insensitive' ? s.toLowerCase() : s;
}

function toPrefixRelative(
  path: string,
  base: string,
  marker: string,
  caseSensitivity: PathCaseSensitivity,
): string {
  if (fold(path, caseSensitivity) === fold(base, caseSensitivity)) return marker;
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return fold(path, caseSensitivity).startsWith(fold(prefix, caseSensitivity))
    ? `${marker}${sep}${path.slice(prefix.length)}`
    : path;
}

/**
 * How one scanned location prints in the empty-state report. Project-scoped
 * candidates come back as absolute paths under the current directory, which
 * tell the reader nothing they do not already know; `.${sep}.mcp.json` says
 * "here" in the width of two characters.
 *
 * cwd wins over home when a path sits under both, being the more specific of
 * the two answers — except when the two are the same directory, where `~`
 * is the more informative marker for a config that is user-wide by nature.
 */
function displayPath(path: string, home: string, cwd: string): string {
  const caseSensitivity = defaultPathCaseSensitivity();
  if (fold(cwd, caseSensitivity) !== fold(home, caseSensitivity)) {
    const relative = toCwdRelative(path, cwd, caseSensitivity);
    if (relative !== path) return relative;
  }
  return toHomeRelative(path, home, caseSensitivity);
}

/**
 * Group detected tools by client, then by type, with names sorted
 * alphabetically. Clients and types with nothing in them are omitted.
 */
export function groupStack(tools: readonly ToolEntry[]): StackGroup[] {
  const groups: StackGroup[] = [];
  for (const client of CLIENT_ORDER) {
    const owned = tools.filter((t) => t.client === client);
    if (owned.length === 0) continue;
    const byType: StackTypeGroup[] = [];
    for (const type of TYPE_ORDER) {
      const names = owned
        .filter((t) => t.type === type)
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b));
      if (names.length > 0) byType.push({ type, names });
    }
    groups.push({ client, label: CLIENT_LABEL[client], total: owned.length, byType });
  }
  return groups;
}

/**
 * The wordmark, printed above every terminal report. A report that gets
 * screenshotted should say what produced it, and the version is what makes a
 * screenshot answerable a year later.
 *
 * Bold with a dim version rather than a brand color: bold is the one emphasis
 * that survives every terminal theme, and the four colors this report does own
 * are spent on the tool types, where they carry meaning.
 */
function masthead(): string {
  return `${c.bold('devcat')} ${c.dim(`v${CLI_VERSION}`)}`;
}

/**
 * Grouped terminal report:
 *
 *   devcat v0.2.2
 *
 *   ✓ Your AI-coding stack — 21 tools
 *
 *   Claude Code · 16 tools
 *     ██████  12 mcp      alpha, beta, gamma, …
 *     ██       4 plugin   swift-lsp, vercel
 *
 *   21 tools in Claude Code, Codex, and Cursor · 8 locations checked
 *   3 project-scoped · 18 user-wide
 *
 *   Share it — npx devcat-cli --markdown
 */
export function renderStackReport(result: DetectResult): string {
  if (result.tools.length === 0) return renderEmptyStack(result);

  const groups = groupStack(result.tools);
  const total = result.tools.length;
  const lines: string[] = [];

  lines.push(masthead());
  lines.push('');
  lines.push(`${SUCCESS_GLYPH} ${c.bold(`Your AI-coding stack — ${plural(total, 'tool')}`)}`);

  // One scale for every bar in the report, so two rows of equal length mean
  // equal counts wherever they sit — and one column width, wide enough for
  // the longest count, so every row lines up with every other.
  const maxTypeCount = Math.max(...groups.flatMap((g) => g.byType.map((t) => t.names.length)));
  const countWidth = Math.max(MIN_COUNT_WIDTH, String(maxTypeCount).length);
  const nameStart = nameColumn(countWidth);

  for (const group of groups) {
    lines.push('');
    lines.push(`${c.bold(group.label)} ${c.dim(`· ${plural(group.total, 'tool')}`)}`);
    for (const { type, names } of group.byType) {
      const accent = TYPE_ACCENT[type];
      // Padding stays outside the color wrapper: the escape codes hug the
      // glyphs, so a stripped line is the plain line, space for space.
      const bar = renderBar(names.length, maxTypeCount);
      const barCell = `${accent(bar)}${' '.repeat(BAR_WIDTH - bar.length)}`;
      const count = c.bold(String(names.length).padStart(countWidth));
      const label = accent(type.padEnd(TYPE_WIDTH));
      const prefix = `${' '.repeat(ROW_INDENT)}${barCell} ${count} ${label}`;
      const wrapped = wrap(names.map(sanitizeName).join(', '), WRAP_WIDTH - nameStart);
      lines.push(`${prefix}${wrapped[0]}`);
      for (const cont of wrapped.slice(1)) {
        lines.push(`${' '.repeat(nameStart)}${cont}`);
      }
    }
  }

  const clientLabels = groups.map((g) => g.label);
  // pathsScanned holds directories (skills, agents) as well as files, so
  // "locations" rather than "config files".
  const locations = result.pathsScanned.length;
  lines.push('');
  lines.push(
    c.dim(
      `${plural(total, 'tool')} in ${joinWithAnd(clientLabels)} · ${plural(locations, 'location')} checked`,
    ),
  );

  // "project-scoped" is the detector's own term: found by walking up from the
  // current directory. Deliberately not phrased as "in this directory" — the
  // match can come from any ancestor.
  const projectScoped = result.tools.filter((t) => t.scope === 'project').length;
  if (projectScoped > 0) {
    lines.push(c.dim(`${projectScoped} project-scoped · ${total - projectScoped} user-wide`));
  }

  if (result.truncations.length > 0) {
    lines.push('');
    lines.push(c.yellow(truncationFootnote(result.truncations)));
  }

  lines.push('');
  lines.push(c.dim(SHARE_HINT));

  return lines.join('\n');
}

/**
 * Closing line of a non-empty report. Dim, so it sits under the result rather
 * than competing with it — the report is the product, this is the next step.
 *
 * Deliberately absent from the empty-state report: there is nothing to share
 * yet, and that state already ends on the step that is actually worth taking.
 */
const SHARE_HINT = 'Share it — npx devcat-cli --markdown';

/**
 * One line admitting the report is incomplete. Short on purpose — the detail
 * goes to stderr and to --json; this exists so a reader of the report itself
 * is never told a partial list is the whole list.
 */
export function truncationFootnote(truncations: readonly RootTruncation[]): string {
  const count = truncations.length;
  return `! ${count} ${count === 1 ? 'location was' : 'locations were'} truncated — some tools are not listed. See --json for details.`;
}

/**
 * Per-root detail, for stderr. Named locations and counts, so the user can
 * see which directory is oversized and by how much.
 */
export function truncationWarnings(truncations: readonly RootTruncation[]): string[] {
  return truncations.map((t) => {
    const parts = [`! Truncated scan of ${sanitizeName(t.root)} —`];
    if (t.hitReadCeiling) {
      // Quote entriesRead, not entriesSeen: the ceiling counts every entry
      // including dot-entries, so a dot-heavy root would otherwise report
      // "0 entries read" in the same line as "ceiling reached".
      parts.push(`reading stopped at the ${READ_CEILING}-entry ceiling after ${t.entriesRead} entries,`);
    } else if (t.readFailed) {
      parts.push(`reading failed after ${t.entriesRead} entries,`);
    } else {
      parts.push(`${t.entriesRead} entries read,`);
    }
    parts.push(`${t.entriesSeen} candidates, ${t.entriesKept} examined.`);
    parts.push('Some tools are not listed.');
    if (t.hitReadCeiling) parts.push('More may exist unread.');
    return parts.join(' ');
  });
}


/**
 * Shareable snippet for a README or gist. Plain markdown, no ANSI, stable
 * ordering so re-running it produces a clean diff rather than a reshuffle.
 */
export function renderStackMarkdown(result: DetectResult): string {
  const lines: string[] = ['## My AI stack', ''];

  if (result.tools.length === 0) {
    lines.push('No AI tooling detected on this machine yet.');
    if (result.truncations.length > 0) {
      lines.push('');
      lines.push(`> ${truncationFootnote(result.truncations)}`);
    }
    lines.push('');
    lines.push(MARKDOWN_FOOTER);
    return lines.join('\n');
  }

  const groups = groupStack(result.tools);
  const total = result.tools.length;
  lines.push(`${plural(total, 'tool')} across ${joinWithAnd(groups.map((g) => g.label))}.`);

  for (const group of groups) {
    lines.push('');
    lines.push(`### ${group.label}`);
    for (const { type, names } of group.byType) {
      const rendered = names.map((n) => `\`${sanitizeMarkdownName(n)}\``).join(', ');
      lines.push(`- **${TYPE_LABEL_MARKDOWN[type]} (${names.length}):** ${rendered}`);
    }
  }

  if (result.truncations.length > 0) {
    lines.push('');
    lines.push(`> ${truncationFootnote(result.truncations)}`);
  }

  lines.push('');
  lines.push(MARKDOWN_FOOTER);
  return lines.join('\n');
}

/**
 * Machine-readable mirror of the terminal report, for `devcat --json`.
 *
 * One JSON object rather than the NDJSON event stream sync emits — this is a
 * result, not a sequence of events. Same grouping, same ordering, same counts
 * as the human report, so a script and a reader see the same scan.
 */
export function renderStackJson(result: DetectResult): string {
  const groups = groupStack(result.tools);
  const total = result.tools.length;
  const projectScoped = result.tools.filter((t) => t.scope === 'project').length;

  const payload = {
    cli_version: CLI_VERSION,
    total,
    project_scoped: projectScoped,
    user_scoped: total - projectScoped,
    clients: groups.map((group) => ({
      client: group.client,
      label: group.label,
      total: group.total,
      types: group.byType.map(({ type, names }) => ({
        type,
        count: names.length,
        names,
      })),
    })),
    paths_checked: result.pathsScanned,
    truncated: result.truncations.length > 0,
    truncations: result.truncations.map((t) => ({
      root: t.root,
      entries_read: t.entriesRead,
      entries_seen: t.entriesSeen,
      entries_kept: t.entriesKept,
      hit_read_ceiling: t.hitReadCeiling,
      read_failed: t.readFailed,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

const MARKDOWN_FOOTER =
  '<sub>Generated by [devcat-cli](https://www.npmjs.com/package/devcat-cli) — `npx devcat-cli --markdown`</sub>';

/**
 * Nothing found. Print the paths that were checked so the user can spot the
 * config location the CLI does not know about yet. Paths under the current
 * directory print `.`-relative and paths under $HOME print home-relative —
 * display only; --json's paths_checked stays absolute for scripts.
 */
function renderEmptyStack(result: DetectResult): string {
  const home = homedir();
  const cwd = process.cwd();
  const list = result.pathsScanned
    .map((p) => `  ${c.dim('-')} ${displayPath(sanitizeName(p), home, cwd)}`)
    .join('\n');
  const lines = [
    masthead(),
    '',
    `${SUCCESS_GLYPH} ${c.bold('No AI tooling detected on this machine yet.')}`,
    '',
    'Looked in:',
    list,
  ];

  // A truncated scan that turned up nothing is NOT "nothing is installed" —
  // it is "we stopped looking". Saying the first would be a lie by omission,
  // and this is the path where it would be least visible.
  if (result.truncations.length > 0) {
    lines.push('');
    lines.push(c.yellow(truncationFootnote(result.truncations)));
  }

  lines.push('');
  lines.push(c.dim('Add an MCP server to Claude Code, Codex, or Cursor and run this again.'));
  return lines.join('\n');
}

/**
 * Greedy word wrap on ", " boundaries. Always returns at least one line.
 * A wrapped line keeps its trailing comma, so the budget check reserves one
 * character for it. A single name longer than `width` still gets its own line
 * rather than being cut.
 */
function wrap(text: string, width: number): string[] {
  const parts = text.split(', ');
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current === '' ? part : `${current}, ${part}`;
    if (current !== '' && candidate.length + 1 > width) {
      lines.push(`${current},`);
      current = part;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
