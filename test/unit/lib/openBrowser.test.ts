import { describe, it, expect, vi } from 'vitest';

const mockOpen = vi.fn().mockResolvedValue(undefined);
vi.mock('open', () => ({ default: mockOpen }));

import { openBrowser } from '../../../src/lib/openBrowser.js';

describe('openBrowser', () => {
  it('opens devcat.dev when host matches', async () => {
    await openBrowser('https://devcat.dev/device', 'devcat.dev');
    expect(mockOpen).toHaveBeenCalledWith('https://devcat.dev/device');
  });

  it('REJECTS evil.com when expected host is devcat.dev (Pitfall 5)', async () => {
    await expect(openBrowser('https://evil.com/phish', 'devcat.dev')).rejects.toThrow(/hostname/);
  });

  it('REJECTS malformed URL', async () => {
    await expect(openBrowser('not-a-url', 'devcat.dev')).rejects.toThrow(/Invalid verification URI/);
  });

  it('does not throw when underlying open() rejects (best-effort)', async () => {
    mockOpen.mockRejectedValueOnce(new Error('xdg-open not installed'));
    await expect(openBrowser('https://devcat.dev/device', 'devcat.dev')).resolves.toBeUndefined();
  });
});
