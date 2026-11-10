import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTiming } from './capture-timing.ts';

test('截图时间诊断保持原调用、返回值及异常，限制数量且不输出像素', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const timing = captureTiming(), pixels = Buffer.from('private-pixels');
  let reads = 0;
  for (let i = 0; i < 20; i++) assert.equal(await timing.read(async () => { reads++; return pixels; }), pixels);
  const original = new Error('private-driver-error');
  await assert.rejects(timing.read(async () => { reads++; throw original; }), error => error === original);
  timing.report();
  assert.equal(reads, 21);
  const samples = JSON.parse(logs[0][1]);
  assert.equal(samples.length, 16);
  assert.ok(samples.every(sample => Number.isFinite(Date.parse(sample.startedUtc)) && sample.elapsedMs >= 0));
  assert.ok(!JSON.stringify(logs).includes('private'));
  t.mock.method(console, 'error', () => { throw new Error('diagnostic unavailable'); });
  timing.report();
  await assert.rejects(timing.read(async () => { throw original; }), error => error === original);
});

test('仅等待开局入口包装既有截图源，选择时不采样', async () => {
  const timing = captureTiming(), frame = Buffer.from('frame');
  let calls = 0;
  const source = async () => { calls++; return frame; };
  assert.equal(timing.source('en-signed-in-texas-game-raise', source), undefined);
  const take = timing.source('en-signed-in-texas-pre-game-waiting-table', source);
  assert.equal(calls, 0);
  assert.equal(await take(), frame);
  assert.equal(calls, 1);
});
