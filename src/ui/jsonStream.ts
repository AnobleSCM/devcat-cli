/**
 * --json mode event stream. Emits newline-delimited JSON to stdout,
 * one event per call. CI scripts parse with `jq -c`. CLI-07.
 *
 * Event shapes are stable contract — adding fields is fine, renaming or
 * removing fields is a major-version bump.
 */
export interface JsonEvent {
  type:
    | 'device.code.requested'
    | 'device.poll'
    | 'device.code.expired'
    | 'device.token.received'
    | 'auth.refresh'
    | 'auth.refresh.failed'
    | 'sync.start'
    | 'sync.success'
    | 'sync.error';
  [key: string]: unknown;
}

let cachedJsonMode: boolean | null = null;

export function isJsonMode(): boolean {
  if (cachedJsonMode !== null) return cachedJsonMode;
  cachedJsonMode = process.argv.includes('--json');
  return cachedJsonMode;
}

export function resetJsonModeCacheForTests(): void {
  cachedJsonMode = null;
}

export function emitEvent(event: JsonEvent): void {
  if (!isJsonMode()) return;
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
