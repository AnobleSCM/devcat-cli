import { describe, it, expect } from 'vitest';
import { mapErrorCode } from '../../../src/lib/errorMap.js';
import { EXIT_GENERIC_ERROR, EXIT_AUTH_ERROR } from '../../../src/lib/exitCodes.js';

describe('mapErrorCode', () => {
  it('rate_limit_exceeded -> exit 1, "Rate-limited" message', () => {
    const m = mapErrorCode('rate_limit_exceeded');
    expect(m.exitCode).toBe(EXIT_GENERIC_ERROR);
    expect(m.message).toContain('Rate-limited');
  });

  it('schema_violation -> exit 1', () => {
    expect(mapErrorCode('schema_violation').exitCode).toBe(EXIT_GENERIC_ERROR);
  });

  it('token_invalid -> exit 2', () => {
    expect(mapErrorCode('token_invalid').exitCode).toBe(EXIT_AUTH_ERROR);
  });

  it('expired_token -> exit 2 + "10 minutes" + "Run `npx @devcat/cli sync` again"', () => {
    const m = mapErrorCode('expired_token');
    expect(m.exitCode).toBe(EXIT_AUTH_ERROR);
    expect(m.message).toContain('10 minutes');
    expect(m.message).toContain('Run `npx @devcat/cli sync` again');
  });

  it('access_denied -> exit 2 + canceled', () => {
    const m = mapErrorCode('access_denied');
    expect(m.exitCode).toBe(EXIT_AUTH_ERROR);
    expect(m.message).toContain('Approval canceled');
  });

  it('payload_too_large -> exit 1 + 64 KB hint', () => {
    const m = mapErrorCode('payload_too_large');
    expect(m.exitCode).toBe(EXIT_GENERIC_ERROR);
    expect(m.message).toContain('64 KB');
  });

  it('unknown code -> exit 1 + fallback', () => {
    const m = mapErrorCode('totally_unknown_code');
    expect(m.exitCode).toBe(EXIT_GENERIC_ERROR);
    expect(m.message).toContain('Sync failed');
  });

  it('invalid_refresh_token -> exit 2', () => {
    const m = mapErrorCode('invalid_refresh_token');
    expect(m.exitCode).toBe(EXIT_AUTH_ERROR);
    expect(m.message).toContain('Session expired');
  });

  it('code_consumed -> exit 2 + run again', () => {
    const m = mapErrorCode('code_consumed');
    expect(m.exitCode).toBe(EXIT_AUTH_ERROR);
    expect(m.message).toContain('already used');
  });
});
