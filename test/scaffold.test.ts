import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

/**
 * Placeholder test so vitest exits 0 before Plan 39-02 lands real tests.
 * Replace with manifest-detection / api-client / device-flow test suites in subsequent plans.
 */
describe('scaffold', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('devcat');
  });
});
