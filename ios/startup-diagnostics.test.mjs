import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startupDiagnostics } from './startup-diagnostics.mjs';

test('startup diagnostics retain lifecycle events across chunks without raw output', async t => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
  const diagnostics = startupDiagnostics(child);
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(args));
  child.emit('spawn');
  diagnostics.output(Buffer.from('Authorization: SECRET\nAttempting to load driver xcui'));
  diagnostics.output(Buffer.from('test SECRET\nPOST /session {"password":"SECRET"}\n'));
  child.signalCode = 'SIGKILL';
  child.emit('exit');
  await diagnostics.report('appium-status', 'unused', async () => ({ simulatorState: 'Shutdown' }));
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes('SECRET'));
  const report = JSON.parse(output[0][1]);
  assert.deepEqual(report.events.map(event => event.phase), ['spawn', 'driver-load-start', 'exit']);
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
  assert.deepEqual(reports, [['appium-session', 'device']]);
});
