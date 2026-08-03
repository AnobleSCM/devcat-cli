import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_VERSION } from '../../src/version.js';

describe('CLI_VERSION parity', () => {
  it('matches the version field in package.json', () => {
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    expect(CLI_VERSION).toBe(packageJson.version);
  });

  // A lockfile regenerated only in part (e.g. hand-editing package.json
  // without ever re-running npm install) silently drifts from the source of
  // truth. Both the top-level version and packages[""].version must track
  // package.json, or a future bump can land half-done again.
  it('matches package-lock.json top-level version and packages[""].version', () => {
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    const packageLockPath = join(__dirname, '..', '..', 'package-lock.json');
    const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));

    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages['']?.version).toBe(packageJson.version);
  });
});
