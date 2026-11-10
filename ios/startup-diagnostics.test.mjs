import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startupDiagnostics, simulatorStartupTrace, inspectSimulator } from './startup-diagnostics.mjs';

test('startup diagnostics retain lifecycle events across chunks without raw output', async t => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
  const diagnostics = startupDiagnostics(child);
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(args));
  child.emit('spawn');
  diagnostics.output(Buffer.from('Authorization: SECRET\nAttempting to load driver xcui'));
  diagnostics.output(Buffer.from('test SECRET\nPOST /session {"password":"SECRET"}\n'));
  diagnostics.output(Buffer.from('Cleaning simulator 00000000-0000-4000-8000-000000000001\n'));
  child.signalCode = 'SIGKILL';
  child.emit('exit');
  await diagnostics.report('appium-status', 'unused', async () => ({ simulatorState: 'Shutdown' }));
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes('SECRET'));
  assert.ok(!serialized.includes('00000000-0000-4000-8000-000000000001'));
  const report = JSON.parse(output[0][1]);
  assert.deepEqual(report.events.map(event => event.phase), ['spawn', 'driver-load-start', 'erase-start', 'exit']);
  assert.equal(report.signalCode, 'SIGKILL');
  assert.equal(report.simulatorState, 'Shutdown');
});

test('inspection and output failures cannot replace the original startup failure', async t => {
  const diagnostics = startupDiagnostics(new EventEmitter());
  const original = new Error('original failure');
  for (const inspect of [async () => { throw new Error('diagnostic failure'); }, async () => ({})]) {
    t.mock.method(console, 'error', () => { throw new Error('output failure'); });
    await assert.rejects(async () => {
      try { throw original; }
      catch (error) {
        await diagnostics.report('simctl-recording', undefined, inspect);
        throw error;
      }
    }, error => error === original);
    t.mock.restoreAll();
  }
});

test('session observation preserves action results, exceptions, and invocation count', async t => {
  const diagnostics = startupDiagnostics(new EventEmitter());
  const reports = [];
  t.mock.method(diagnostics, 'report', async (...args) => reports.push(args));
  let calls = 0;
  assert.equal(await diagnostics.run('appium-session', 'device', async () => { calls++; return 42; }), 42);
  assert.equal(calls, 1);
  assert.deepEqual(reports, []);
  assert.equal(diagnostics.reportFailure(true, 'simctl-recording', 'device'), undefined);
  assert.deepEqual(reports, []);
  const original = new Error('original session failure');
  await assert.rejects(diagnostics.run('appium-session', 'device', async () => { calls++; throw original; }), error => error === original);
  assert.equal(calls, 2);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].slice(0, 2), ['appium-session', 'device']);
  assert.ok(Array.isArray(reports[0][3]));
});


test('session state trace is bounded, redacted, and stops without waiting for an in-flight observation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const trace = simulatorStartupTrace('unused', async () => ({
    simulatorState: ++calls % 2 ? 'Shutdown' : 'Booted', deviceName: 'SECRET',
  }));
  await Promise.resolve();
  for (let index = 0; index < 40; index++) {
    t.mock.timers.tick(1000);
    await Promise.resolve();
  }
  assert.equal(trace.samples.length, 32);
  assert.ok(!JSON.stringify(trace.samples).includes('SECRET'));
  trace.stop();
  t.mock.timers.tick(1000);
  assert.equal(calls, 41);
  let finish;
  const pending = simulatorStartupTrace('unused', () => new Promise(resolve => { finish = resolve; }));
  pending.stop();
  finish({ simulatorState: 'Booted' });
  await Promise.resolve();
  assert.deepEqual(pending.samples, []);
});

test('state inspection failures and unexpected output cannot change session results', async () => {
  const failed = simulatorStartupTrace('unused', async () => { throw new Error('SECRET'); });
  await Promise.resolve();
  failed.stop();
  assert.deepEqual(failed.samples, []);
  const unsafe = simulatorStartupTrace('unused', async () => ({ simulatorState: 'SECRET' }));
  await Promise.resolve();
  unsafe.stop();
  assert.equal(unsafe.samples[0].state, 'unavailable');
});

test('simulator discovery distinguishes missing devices from query failures without raw errors', async () => {
  const udid = '00000000-0000-4000-8000-000000000001';
  const missing = await inspectSimulator(udid, async () => ({ stdout: '{"devices":{}}' }));
  assert.equal(missing.simulatorPresent, false);
  for (const killed of [true, false]) {
    const result = await inspectSimulator(udid, async () => {
      throw Object.assign(new Error('SECRET'), { killed, stderr: 'SECRET' });
    });
    assert.equal(result.simulatorState, 'unavailable');
    assert.equal(result.simulatorQueryError, killed ? 'timeout' : 'query-failed');
    assert.equal(result.simulatorPresent, undefined);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
});
