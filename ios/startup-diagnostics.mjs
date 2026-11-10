// Only fixed lifecycle labels and process/state metadata may leave this collector.
// Appium output can contain credentials, CA contents and session request bodies.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadavg } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
// Run only after startup fails, never during animation sampling. Process counts
// distinguish a busy runner from accumulated test tools without exposing args.
export async function reportSimulatorFailure(udid, query = execute) {
  try {
    const simulator = await inspectSimulator(udid, query);
    const { stdout } = await query('ps', ['-axo', 'comm='], { timeout: 5000, maxBuffer: 1024 * 1024 })
      .catch(() => ({ stdout: undefined }));
    const names = (stdout || '').trim().split('\n').map(line => line.trim().split('/').at(-1));
    const processes = stdout === undefined ? { unavailable: true } : Object.fromEntries(['node', 'xcodebuild', 'simctl', 'Simulator', 'SimulatorTrampoline']
      .map(name => [name, names.filter(value => value === name).length]));
    console.error('[iOS simulator startup failure]', JSON.stringify({ ...simulator, loadAverage: loadavg(), processes }));
  } catch { /* Preserve the original boot/status-bar failure. */ }
}
const phases = [
  ['server-start', /Welcome to Appium/],
  ['driver-load-start', /Attempting to load driver xcuitest/],
  ['driver-load-complete', /XCUITestDriver has been successfully loaded/],
  ['listener-ready', /Appium REST http interface listener started/],
  ['full-reset', /Reset: fullReset is on/],
  ['shutdown-start', /Shutting down Simulator/],
  ['already-shutdown', /Simulator is already shut down/],
  ['erase-start', /Erasing (?:contents|simulator)/i],
  ['erase-start', /Cleaning simulator [a-f\d-]{36}/i],
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

export async function inspectSimulator(udid, query = execute) {
  const result = {};
  if (/^[a-f\d-]{36}$/i.test(udid || '')) {
    try {
      const { stdout } = await query('xcrun', ['simctl', 'list', '-j', 'devices'], { timeout: 5000, maxBuffer: 1024 * 1024 });
      const device = Object.values(JSON.parse(stdout).devices).flat().find(device => device.udid === udid);
      result.simulatorState = ['Booted', 'Shutdown', 'Booting', 'Shutting Down'].includes(device?.state) ? device.state : 'unknown';
      result.simulatorPresent = !!device;
    } catch (error) {
      result.simulatorState = 'unavailable';
      // A timed-out discovery query is not evidence that the device was deleted.
      // Never export stderr, command arguments or the raw exception message.
      result.simulatorQueryError = error.killed ? 'timeout'
        : error instanceof SyntaxError ? 'invalid-json' : 'query-failed';
    }
  }
  return result;
}

async function inspect(udid, pid) {
  const [processState, simulator] = await Promise.all([inspectProcess(pid), inspectSimulator(udid)]);
  return { ...processState, ...simulator };
}

// Observe only session startup, never animation capture. Keep state transitions,
// not device names, IDs, raw simctl output or application data.
export function simulatorStartupTrace(udid, observe = inspectSimulator) {
  const samples = [];
  let stopped = false, timer;
  const started = performance.now();
  const sample = async () => {
    try {
      const { simulatorState } = await observe(udid);
      const state = ['Booted', 'Shutdown', 'Booting', 'Shutting Down', 'unknown', 'unavailable'].includes(simulatorState)
        ? simulatorState : 'unavailable';
      if (!stopped && state !== samples.at(-1)?.state) {
        samples.push({ state, elapsedMs: Math.round(performance.now() - started) });
        if (samples.length > 32) samples.shift();
      }
    } catch { /* Observation must never affect session establishment. */ }
    if (!stopped) { timer = setTimeout(sample, 1000); timer.unref(); }
  };
  void sample();
  return { samples, stop() { stopped = true; clearTimeout(timer); } };
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
      const trace = phase === 'appium-session' ? simulatorStartupTrace(udid) : undefined;
      try { return await action(); }
      catch (error) {
        trace?.stop();
        await diagnostics.report(phase, udid, inspect, trace?.samples);
        throw error;
      } finally { trace?.stop(); }
    },
    reportFailure(completed, phase, udid) {
      if (!completed) return diagnostics.report(phase, udid);
    },
    async report(phase, udid, inspectState = inspect, simulatorStates) {
      // Diagnostic failure must never replace the original startup exception.
      try {
        const exitCode = child.exitCode, signalCode = child.signalCode;
        const state = await inspectState(udid, child.pid);
        console.error('[iOS startup]', JSON.stringify({ phase, elapsedMs: Math.round(performance.now() - started),
          pid: child.pid, exitCode, signalCode, loadAverage: loadavg(), events, simulatorStates, ...state }));
      } catch { /* Keep the original failure and result. */ }
    },
  };
  return diagnostics;
}

/** Keep the exact operation result or exception; inspect only after failure. */
export async function withSimulatorFailure(udid, action, query = execute) {
  try { return await action(); }
  catch (error) { await reportSimulatorFailure(udid, query); throw error; }
}

/** Startup readiness only: preserve the status assertion and per-request deadline. */
export async function waitForAppium(server, driver, pause = delay) {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`Appium 启动失败：${server.exitCode}`);
    try { await driver.request('GET', '/status', undefined, 5000); return; }
    catch (error) { if (attempt >= 359) throw error; await pause(500); }
  }
}
