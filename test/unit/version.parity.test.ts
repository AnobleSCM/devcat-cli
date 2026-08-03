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
});
