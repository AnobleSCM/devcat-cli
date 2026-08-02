import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * devcat.dev is being rebuilt, so `devcat sync` stops on one line instead of
 * starting a device flow that cannot finish. This suite deliberately does NOT
 * set DEVCAT_SYNC_ENABLED — it covers the paused path the other sync
 * integration suites opt out of.
 */
process.env.NO_COLOR = '1';

const originalFlag = process.env.DEVCAT_SYNC_ENABLED;

beforeEach(() => {
  delete process.env.DEVCAT_SYNC_ENABLED;
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.DEVCAT_SYNC_ENABLED;
  else process.env.DEVCAT_SYNC_ENABLED = originalFlag;
});

describe('sync — paused while devcat.dev is down', () => {
  it('prints exactly one line, opens no browser, makes no request, exits 1', async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const outSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { runSync } = await import('../../src/commands/sync.js');
    const exitCode = await runSync({ noOpen: false });

    errSpy.mockRestore();
    outSpy.mockRestore();
    fetchSpy.mockRestore();

    expect(exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stdout.join('')).toBe('');

    const err = stderr.join('');
    expect(err.trimEnd().split('\n')).toHaveLength(1);
    expect(err).toContain('Profile sync is paused while devcat.dev is rebuilt.');
    expect(err).toContain('npx devcat-cli');
    // No stack trace, no retry noise.
    expect(err).not.toContain('at ');
    expect(err).not.toContain('Error:');
  });
});
