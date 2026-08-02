#!/usr/bin/env node
import { runCli } from '../cli.js';
import { EXIT_GENERIC_ERROR } from '../lib/exitCodes.js';

runCli(process.argv)
  .then((exitCode) => process.exit(exitCode))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT_GENERIC_ERROR);
  });
