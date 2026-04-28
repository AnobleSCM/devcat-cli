/**
 * CLI version constant. MUST match package.json "version" field.
 *
 * Sent as cli_version on POST /api/device/token per Phase 40 D-06.
 * Server validates against semver regex /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.
 */
export const CLI_VERSION = '0.1.0';
