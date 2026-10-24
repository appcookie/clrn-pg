import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Keep only the app identity, failure type and symbolicated stack locations.
 * Never attach the complete report's process environment or memory/registers.
 */
export function nativeCrashSummary(source: string, bundleId: string) {
  if (typeof bundleId !== 'string' || !bundleId) return null;
  const newline = source.indexOf('\n');
  if (newline < 0) return null;
  let report;
  try { report = JSON.parse(source.slice(newline + 1)); } catch { return null; }
  if (report.bundleInfo?.CFBundleIdentifier !== bundleId) return null;
  return {
    bundleId, process: report.procName, captureTime: report.captureTime,
    exception: report.exception && { type: report.exception.type, signal: report.exception.signal,
      subtype: report.exception.subtype },
    termination: report.termination && { namespace: report.termination.namespace, code: report.termination.code,
      indicator: report.termination.indicator },
    faultingThread: report.faultingThread,
    threads: (report.threads || []).map((thread: { triggered?: boolean; frames?: Record<string, unknown>[] }) => ({
      triggered: thread.triggered,
      frames: (thread.frames || []).map(frame => ({ imageIndex: frame.imageIndex, imageOffset: frame.imageOffset,
        symbol: frame.symbol, symbolLocation: frame.symbolLocation })),
    })),
    images: (report.usedImages || []).map((image: { name?: string; arch?: string; uuid?: string }) => ({
      name: image.name, arch: image.arch, uuid: image.uuid,
    })),
  };
}

export async function recentNativeCrashes(bundleId: string) {
  const directory = join(homedir(), 'Library/Logs/DiagnosticReports');
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const summaries = [];
  for (const name of names.filter(name => name.endsWith('.ips'))) {
    const path = join(directory, name), details = await stat(path);
    if (Date.now() - details.mtimeMs > 15 * 60_000 || details.size > 16 * 1024 * 1024) continue;
    const summary = nativeCrashSummary(await readFile(path, 'utf8'), bundleId);
    if (summary) summaries.push(summary);
  }
  return summaries;
}
