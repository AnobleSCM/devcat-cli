#!/usr/bin/env node
import { runCli } from '../cli.js';
import { EXIT_GENERIC_ERROR } from '../lib/exitCodes.js';

/**
 * Set process.exitCode and let Node exit on its own.
 *
 * process.exit() terminates immediately, discarding anything still queued in
 * stdout. That matters here: process.stdout is a pipe when output is piped
 * (`devcat --json | jq`), pipes are asynchronous, and a large report does not
 * fit in one write — so exiting on the spot could cut the JSON mid-object and
 * still report success. Setting exitCode lets the event loop drain the stream
 * first and then exit with the same code.
 *
 * Nothing here holds the loop open — no servers, no timers — so "let it exit
 * naturally" costs nothing.
 */
runCli(process.argv)
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = EXIT_GENERIC_ERROR;
  });
