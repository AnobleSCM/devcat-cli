import { Command } from 'commander';
import { CLI_VERSION } from './version.js';
import { runReport } from './commands/report.js';
import { runSync } from './commands/sync.js';
import { runLogout } from './commands/logout.js';
import { EXIT_GENERIC_ERROR, EXIT_OK, type ExitCode } from './lib/exitCodes.js';

/**
 * Commander wiring, separated from the bin entrypoint so tests can run the
 * real parser over a real argv array. bin/devcat.ts is then a small shim
 * whose only extra job is assigning the returned code to process.exitCode —
 * the part that cannot run inside a test process.
 *
 * Actions record an exit code rather than terminating the process, so the
 * parser is testable and every exit flows through one place. Nothing here
 * calls process.exit: doing so after writing stdout can truncate a piped
 * report (see bin/devcat.ts).
 */
export interface ExitCodeSink {
  code: ExitCode;
}

export function buildProgram(sink: ExitCodeSink): Command {
  const program = new Command();
  // Without this commander calls process.exit() itself on a bad flag, on
  // --help, and on --version — untestable, and a hard exit that could cut a
  // half-written stdout. With it, those become throws that runCli turns into
  // a returned code, which the shim assigns to process.exitCode.
  program.exitOverride();
  program
    .name('devcat')
    .description(
      'DevCat CLI — see your whole AI-coding stack in one command. Scans this machine for the MCP servers, plugins, skills, and subagents installed across Claude Code, Codex, and Cursor.',
    )
    .version(CLI_VERSION);

  // Declared at program level too so `devcat --json` (the default command)
  // parses. Commander consumes program-level flags before dispatching, so the
  // report action reads both its own options and the program's.
  program
    .option('--json', 'emit machine-readable JSON output')
    .option('-v, --verbose', 'emit redacted HTTP trace to stderr');

  program
    .command('report', { isDefault: true })
    .description('Scan this machine and print your AI-coding stack (default)')
    .option('--markdown', 'emit a shareable "My AI stack" markdown snippet')
    .option('--json', 'emit the scan as one machine-readable JSON object (wins over --markdown)')
    .action(async (options: { markdown?: boolean; json?: boolean }) => {
      sink.code = await runReport({
        markdown: options.markdown === true,
        json: options.json === true || program.opts().json === true,
      });
    });

  program
    .command('sync')
    .description('Push your AI tool manifest to devcat.dev (hosted sync retired)')
    .option('--no-open', 'do not auto-open the browser at the verification URL')
    .option('--json', 'emit machine-readable JSON event stream (for CI)')
    .option('-v, --verbose', 'emit redacted HTTP trace to stderr')
    .action(async (options: { open?: boolean }) => {
      sink.code = await runSync({ noOpen: options.open === false });
    });

  program
    .command('logout')
    .description('Clear local DevCat credentials')
    .action(async () => {
      sink.code = await runLogout();
    });

  return program;
}

/** Parse `argv` with the real commander program and return the exit code. */
export async function runCli(argv: string[]): Promise<ExitCode> {
  // Commander actions have no return channel, so they write the resolved code
  // into this holder.
  const sink: ExitCodeSink = { code: EXIT_OK };
  const program = buildProgram(sink);
  try {
    await program.parseAsync(argv);
    return sink.code;
  } catch (err) {
    // Commander has already written its own output for these — the help text,
    // the version, or an `error: unknown option ...` line. Reporting it again
    // would double-print. exitCode 0 means it displayed help or version.
    const commanderError = err as { code?: unknown; exitCode?: unknown };
    if (typeof commanderError.code === 'string' && typeof commanderError.exitCode === 'number') {
      return commanderError.exitCode === 0 ? EXIT_OK : EXIT_GENERIC_ERROR;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_GENERIC_ERROR;
  }
}
