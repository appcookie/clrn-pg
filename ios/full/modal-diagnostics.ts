import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const categories = ['already presenting', 'presentation is in progress', 'dismissal is in progress'] as const;

/** Export only fixed UIKit warning categories and timestamps, never raw simulator logs. */
export function modalWarningSummary(source: string) {
  return source.split('\n').flatMap(line => {
    let event;
    try { event = JSON.parse(line); } catch { return []; }
    if (!event || typeof event !== 'object') return [];
    const category = categories.find(value => typeof event.eventMessage === 'string'
      && event.eventMessage.includes(value));
    if (!category) return [];
    const timestamp = typeof event.timestamp === 'string'
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+(?:[+-]\d{4}|Z)?$/.test(event.timestamp)
      ? event.timestamp : undefined;
    return [{ category, timestamp }];
  }).slice(-16);
}

/** Called only after failure: does not add native queries during animation sampling. */
export async function recentModalWarnings(udid: string, execute = run) {
  const predicate = categories.map(value => `eventMessage CONTAINS "${value}"`).join(' OR ');
  const { stdout } = await execute('xcrun', ['simctl', 'spawn', udid, 'log', 'show',
    '--style', 'ndjson', '--last', '3m', '--predicate', predicate],
  { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
  return modalWarningSummary(stdout);
}
