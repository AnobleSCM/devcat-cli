import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The bin shim must NOT call process.exit().
 *
 * process.exit terminates immediately and discards whatever is still queued
 * in stdout. stdout is a pipe when output is piped, pipes are asynchronous,
 * and a large `--json` report does not fit in a single write — so exiting on
 * the spot could truncate the JSON mid-object while still reporting success.
 *
 * A true end-to-end pipe test would have to spawn the built CLI, which makes
 * the suite depend on `dist/` existing and on build ordering. This asserts the
 * property that actually prevents the truncation instead: the real shim module
 * sets process.exitCode and returns, leaving Node to drain stdout and exit on
 * its own. The module self-executes on import, which is exactly the behaviour
 * under test.
 */
const { runCliMock } = vi.hoisted(() => ({ runCliMock: vi.fn() }));

vi.mock('../../src/cli.js', () => ({ runCli: runCliMock }));

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.resetModules();
  runCliMock.mockReset();
});

async function importShim(): Promise<void> {
  vi.resetModules();
  await import('../../src/bin/devcat.js');
  // The shim's promise chain settles on the microtask queue.
  await new Promise((resolve) => setImmediate(resolve));
}

describe('bin shim — exit handling', () => {
  it('sets process.exitCode instead of calling process.exit', async () => {
    runCliMock.mockResolvedValue(0);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit must not be called — it can truncate piped stdout');
    }) as never);

    try {
      await importShim();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('propagates a non-zero code the same way', async () => {
    runCliMock.mockResolvedValue(2);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit must not be called');
    }) as never);

    try {
      await importShim();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('reports a thrown error on stderr and exits 1, still without process.exit', async () => {
    runCliMock.mockRejectedValue(new Error('boom'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit must not be called');
    }) as never);
    const errChunks: string[] = [];
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        errChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });

    try {
      await importShim();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(errChunks.join('')).toContain('boom');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('the whole report is handed to stdout before the shim resolves', async () => {
    // The other half of the guarantee: nothing is written after the process
    // is already on its way out. runCli must finish its writes first.
    let writesAtResolve = 0;
    const chunks: string[] = [];
    const outSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    runCliMock.mockImplementation(async () => {
      process.stdout.write('x'.repeat(100_000));
      writesAtResolve = chunks.length;
      return 0;
    });

    try {
      await importShim();
      expect(writesAtResolve).toBe(1);
      expect(chunks.join('')).toHaveLength(100_000);
      expect(process.exitCode).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
  });
});
