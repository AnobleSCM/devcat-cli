import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The read ceiling has to bound the READS, not just the output. Asserting on
 * the returned counts cannot tell "stopped at 10,000" from "read 10,001 and
 * kept 10,000" — and the README promises the remainder is never read.
 *
 * So this suite hands the scanner a fake directory whose async iterator
 * counts next() calls, and asserts on that count directly.
 */
const reads = { count: 0 };
const dirNames: { current: string[] } = { current: [] };

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    opendir: async () => ({
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            reads.count += 1;
            if (index >= dirNames.current.length) {
              return { done: true as const, value: undefined };
            }
            return { done: false as const, value: { name: dirNames.current[index++]! } };
          },
          async return() {
            return { done: true as const, value: undefined };
          },
        };
      },
    }),
  };
});

beforeEach(() => {
  reads.count = 0;
  dirNames.current = Array.from({ length: 50 }, (_, i) => `entry-${String(i).padStart(3, '0')}`);
});

describe('read ceiling bounds the reads, not just the results', () => {
  it('pulls exactly `readCeiling` entries and no more', async () => {
    const { scanSkills } = await import('../../../src/manifest/dirScan.js');
    const result = await scanSkills('/fake/root', 10);

    // The off-by-one this covers: `for await` fetches the next entry BEFORE
    // the loop body can check the ceiling, so a top-of-body check reads
    // ceiling + 1. Exactly 10 means the 11th was never requested.
    expect(reads.count).toBe(10);
    expect(result.truncation).not.toBeNull();
    expect(result.truncation!.hitReadCeiling).toBe(true);
    expect(result.truncation!.entriesRead).toBe(10);
  });

  it('reads the whole directory when it fits under the ceiling', async () => {
    dirNames.current = ['a', 'b', 'c'];
    const { scanSkills } = await import('../../../src/manifest/dirScan.js');
    const result = await scanSkills('/fake/root', 10);

    // Three entries plus the one next() that reports done.
    expect(reads.count).toBe(4);
    expect(result.truncation).toBeNull();
  });

  it('stops at the ceiling even when every entry is a dot-entry', async () => {
    // Dot-entries are not candidates but must still consume the ceiling,
    // or a directory full of them would be read to the end.
    dirNames.current = Array.from({ length: 50 }, (_, i) => `.hidden-${i}`);
    const { scanSkills } = await import('../../../src/manifest/dirScan.js');
    const result = await scanSkills('/fake/root', 6);

    expect(reads.count).toBe(6);
    expect(result.truncation!.hitReadCeiling).toBe(true);
    // R1: the message must quote what the ceiling counts. entriesSeen is 0
    // here (no candidates), so entriesRead is what makes the disclosure
    // coherent rather than self-contradictory.
    expect(result.truncation!.entriesRead).toBe(6);
    expect(result.truncation!.entriesSeen).toBe(0);
  });

  it('uses the production ceiling by default', async () => {
    const { READ_CEILING } = await import('../../../src/manifest/dirScan.js');
    expect(READ_CEILING).toBe(10_000);
  });
});

describe('a directory that errors partway is disclosed', () => {
  it('marks the scan truncated with readFailed even when few names were read', async () => {
    // R2: an error-shortened scan used to return a short list with no
    // truncation metadata at all, which reads as a complete scan.
    const failingNames = ['a', 'b'];
    dirNames.current = failingNames;
    vi.resetModules();

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        opendir: async () => ({
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              async next() {
                if (index >= failingNames.length) throw new Error('EIO: directory vanished');
                return { done: false as const, value: { name: failingNames[index++]! } };
              },
              async return() {
                return { done: true as const, value: undefined };
              },
            };
          },
        }),
      };
    });

    const { scanSkills } = await import('../../../src/manifest/dirScan.js');
    const result = await scanSkills('/fake/root');

    expect(result.truncation).not.toBeNull();
    expect(result.truncation!.readFailed).toBe(true);
    expect(result.truncation!.hitReadCeiling).toBe(false);
    expect(result.truncation!.entriesRead).toBe(2);
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});
