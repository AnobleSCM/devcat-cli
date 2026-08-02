import type { DetectResult, ToolEntry, ToolClient } from '../manifest/index.js';
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

/** Total line width the terminal report wraps to. */
const WRAP_WIDTH = 78;
/** Width of the type label column — one wider than the longest type name. */
const TYPE_WIDTH = 9;
/** Column where the comma-separated names start (and continuation lines indent to). */
const NAME_COLUMN = 15;

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
 * Grouped terminal report:
 *
 *   ✓ Your AI-coding stack — 21 tools
 *
 *   Claude Code · 16 tools
 *      12 mcp      alpha, beta, gamma, …
 *       4 plugin   swift-lsp, vercel
 *
 *   21 tools in Claude Code, Codex, and Cursor · 8 locations checked
 *   3 project-scoped · 18 user-wide
 */
export function renderStackReport(result: DetectResult): string {
  if (result.tools.length === 0) return renderEmptyStack(result.pathsScanned);

  const groups = groupStack(result.tools);
  const total = result.tools.length;
  const lines: string[] = [];

  lines.push(`${SUCCESS_GLYPH} ${c.bold(`Your AI-coding stack — ${plural(total, 'tool')}`)}`);

  for (const group of groups) {
    lines.push('');
    lines.push(`${c.bold(group.label)} ${c.dim(`· ${plural(group.total, 'tool')}`)}`);
    for (const { type, names } of group.byType) {
      const prefix = `  ${String(names.length).padStart(3)} ${type.padEnd(TYPE_WIDTH)}`;
      const wrapped = wrap(names.map(sanitizeName).join(', '), WRAP_WIDTH - NAME_COLUMN);
      lines.push(`${prefix}${wrapped[0]}`);
      for (const cont of wrapped.slice(1)) {
        lines.push(`${' '.repeat(NAME_COLUMN)}${cont}`);
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

  return lines.join('\n');
}

/**
 * Shareable snippet for a README or gist. Plain markdown, no ANSI, stable
 * ordering so re-running it produces a clean diff rather than a reshuffle.
 */
export function renderStackMarkdown(result: DetectResult): string {
  const lines: string[] = ['## My AI stack', ''];

  if (result.tools.length === 0) {
    lines.push('No AI tooling detected on this machine yet.');
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
  };
  return JSON.stringify(payload, null, 2);
}

const MARKDOWN_FOOTER =
  '<sub>Generated by [devcat-cli](https://www.npmjs.com/package/devcat-cli) — `npx devcat-cli --markdown`</sub>';

/**
 * Nothing found. Print the paths that were checked so the user can spot the
 * config location the CLI does not know about yet.
 */
function renderEmptyStack(pathsScanned: string[]): string {
  const list = pathsScanned.map((p) => `  - ${p}`).join('\n');
  return [
    `${SUCCESS_GLYPH} ${c.bold('No AI tooling detected.')}`,
    '',
    'Looked in:',
    list,
    '',
    c.dim('Add an MCP server to Claude Code, Codex, or Cursor and run this again.'),
  ].join('\n');
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
