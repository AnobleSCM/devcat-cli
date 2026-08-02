import { detect } from '../manifest/index.js';
import { renderStackReport, renderStackMarkdown } from '../ui/report.js';
import { EXIT_OK, type ExitCode } from '../lib/exitCodes.js';

export interface ReportOptions {
  /** Emit the shareable "My AI stack" markdown snippet instead of the terminal report. */
  markdown: boolean;
}

/**
 * `devcat report` — also the default command when devcat is run with no args.
 *
 * Local-only: scans this machine's AI tool config files and prints what it
 * found. No network, no auth, no credentials touched. An empty result is a
 * valid outcome, not an error, so this always exits 0.
 */
export async function runReport(opts: ReportOptions): Promise<ExitCode> {
  const manifest = await detect(process.cwd());
  const out = opts.markdown ? renderStackMarkdown(manifest) : renderStackReport(manifest);
  process.stdout.write(`${out}\n`);
  return EXIT_OK;
}
