#!/usr/bin/env node
import { Command } from 'commander';
import { CLI_VERSION } from '../version.js';
import { runReport } from '../commands/report.js';
import { runSync } from '../commands/sync.js';
import { runLogout } from '../commands/logout.js';
import { EXIT_GENERIC_ERROR } from '../lib/exitCodes.js';

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('devcat')
    .description(
      'DevCat CLI — see your whole AI-coding stack in one command. Scans this machine for the MCP servers and plugins installed across Claude Code, Codex, and Cursor.',
    )
    .version(CLI_VERSION);

  // Global flags. isJsonMode() reads process.argv directly (not commander
  // state) so these declarations exist primarily to populate --help.
  program
    .option('--json', 'emit machine-readable JSON event stream')
    .option('-v, --verbose', 'emit redacted HTTP trace to stderr');

  program
    .command('report', { isDefault: true })
    .description('Scan this machine and print your AI-coding stack (default)')
    .option('--markdown', 'emit a shareable "My AI stack" markdown snippet')
    .action(async (options: { markdown?: boolean }) => {
      const exitCode = await runReport({ markdown: options.markdown === true });
      process.exit(exitCode);
    });

  program
    .command('sync')
    .description('Push your AI tool manifest to devcat.dev (paused while the site is rebuilt)')
    .option('--no-open', 'do not auto-open the browser at the verification URL')
    .option('--json', 'emit machine-readable JSON event stream (for CI)')
    .option('-v, --verbose', 'emit redacted HTTP trace to stderr')
    .action(async (options: { open?: boolean }) => {
      const exitCode = await runSync({ noOpen: options.open === false });
      process.exit(exitCode);
    });

  program
    .command('logout')
    .description('Clear local DevCat credentials')
    .action(async () => {
      const exitCode = await runLogout();
      process.exit(exitCode);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT_GENERIC_ERROR);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT_GENERIC_ERROR);
});
