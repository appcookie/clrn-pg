// Only fixed lifecycle labels and process/state metadata may leave this collector.
// Appium output can contain credentials, CA contents and session request bodies.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadavg } from 'node:os';

const execute = promisify(execFile);
const phases = [
  ['server-start', /Welcome to Appium/],
  ['driver-load-start', /Attempting to load driver xcuitest/],
  ['driver-load-complete', /XCUITestDriver has been successfully loaded/],
  ['listener-ready', /Appium REST http interface listener started/],
  ['full-reset', /Reset: fullReset is on/],
  ['shutdown-start', /Shutting down Simulator/],
  ['already-shutdown', /Simulator is already shut down/],
  ['erase-start', /Erasing (?:contents|simulator)/i],
];

async function inspectProcess(pid) {
  const result = {};
  // No command arguments, environment, device names, or raw tool output.
  if (Number.isInteger(pid) && pid > 0) {
    try {
      const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'stat=,etime=,%cpu=,%mem='], { timeout: 5000, maxBuffer: 4096 });
      const fields = stdout.trim().split(/\s+/);
      if (fields.length === 4 && /^[A-Za-z+<>Ns]+$/.test(fields[0])
        && /^[\d:-]+$/.test(fields[1]) && fields.slice(2).every(value => /^\d+(\.\d+)?$/.test(value))) {
        result.process = { state: fields[0], elapsed: fields[1], cpu: Number(fields[2]), memory: Number(fields[3]) };
      }
    } catch { result.processUnavailable = true; }
  }
  return result;
}

async function inspectSimulator(udid) {
  const result = {};
  if (/^[a-f\d-]{36}$/i.test(udid || '')) {
    try {
      const { stdout } = await execute('xcrun', ['simctl', 'list', '-j', 'devices'], { timeout: 5000, maxBuffer: 1024 * 1024 });
      const device = Object.values(JSON.parse(stdout).devices).flat().find(device => device.udid === udid);
      result.simulatorState = ['Booted', 'Shutdown', 'Booting', 'Shutting Down'].includes(device?.state) ? device.state : 'unknown';
    } catch { result.simulatorState = 'unavailable'; }
  }
  return result;
}

async function inspect(udid, pid) {
  const [processState, simulator] = await Promise.all([inspectProcess(pid), inspectSimulator(udid)]);
  return { ...processState, ...simulator };
}

export function startupDiagnostics(child) {
  const started = performance.now();
  const events = [];
  let pending = '';
  const mark = phase => {
    events.push({ phase, elapsedMs: Math.round(performance.now() - started) });
    if (events.length > 32) events.shift();
  };
  child.once('spawn', () => mark('spawn'));
  child.once('exit', () => mark('exit'));
  child.once('error', () => mark('process-error'));
  const diagnostics = {
    mark,
    output(bytes) {
      pending += bytes.toString();
      const lines = pending.split('\n');
      pending = lines.pop().slice(-4096);
      for (const line of lines) {
        for (const [phase, pattern] of phases) if (pattern.test(line)) mark(phase);
      }
    },
    async run(phase, udid, action) {
      mark(phase);
      try { return await action(); }
      catch (error) { await diagnostics.report(phase, udid); throw error; }
    },
    reportFailure(completed, phase, udid) {
      if (!completed) return diagnostics.report(phase, udid);
    },
    async report(phase, udid, inspectState = inspect) {
      // Diagnostic failure must never replace the original startup exception.
      try {
        const exitCode = child.exitCode, signalCode = child.signalCode;
        const state = await inspectState(udid, child.pid);
        console.error('[iOS startup]', JSON.stringify({ phase, elapsedMs: Math.round(performance.now() - started),
          pid: child.pid, exitCode, signalCode, loadAverage: loadavg(), events, ...state }));
      } catch { /* Keep the original failure and result. */ }
    },
  };
  return diagnostics;
}
