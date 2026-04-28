/**
 * Exit code taxonomy per Phase 39 CONTEXT D-14.
 *
 * Three buckets — covers CI scripting needs without sysexits.h-level granularity.
 *
 *   0 = success
 *   1 = generic error (network, schema violation, server 5xx, rate-limit, manifest parsing)
 *   2 = auth-specific (token invalid, device flow timeout, user denied, refresh expired)
 *
 * Use cases:
 *   `if [ $? -eq 2 ]; then npx devcat sync; fi`  — CI script re-trigger device flow
 */
export const EXIT_OK = 0;
export const EXIT_GENERIC_ERROR = 1;
export const EXIT_AUTH_ERROR = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_GENERIC_ERROR | typeof EXIT_AUTH_ERROR;
