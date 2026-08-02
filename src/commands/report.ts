import { detect } from '../manifest/index.js';
import { renderStackReport, renderStackMarkdown, renderStackJson } from '../ui/report.js';
import { EXIT_OK, type ExitCode } from '../lib/exitCodes.js';

export interface ReportOptions {
  /** Emit the shareable "My AI stack" markdown snippet instead of the terminal report. */
  markdown: boolean;
  /** Emit one machine-readable JSON object. Comes from commander, not process.argv. */
  json: boolean;
}

/**
 * `devcat report` — also the default command when devcat is run with no args.
 *
 * Local-only: scans this machine's AI tool config files and prints what it
 * found. No network, no auth, no credentials touched. An empty result is a
 * valid outcome, not an error, so this always exits 0.
 *
 * Three renderings of one scan. `--json` wins over `--markdown` when both are
 * passed: a caller asking for machine-readable output is scripting, and a
 * markdown document would break their parser.
 */
export async function runReport(opts: ReportOptions): Promise<ExitCode> {
  const manifest = await detect(process.cwd());
  let out: string;
  if (opts.json) {
    out = renderStackJson(manifest);
  } else if (opts.markdown) {
    out = renderStackMarkdown(manifest);
  } else {
    out = renderStackReport(manifest);
  }
  process.stdout.write(`${out}\n`);
  return EXIT_OK;
}
