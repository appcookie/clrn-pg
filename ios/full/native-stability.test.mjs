import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { stableNativeObservation } from './native-stability.ts';

test('慢速首次原生查询仍须取得两份真实稳定证据，不能与空占位符比较', async () => {
  let calls = 0;
  const bounds = { x: 0, y: 0, width: 492, height: 1329 };
  const actual = await stableNativeObservation(async () => {
    calls++; await delay(10); return { ...bounds };
  }, (before, current) => assert.deepEqual(current, before), { timeout: 1, interval: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(actual, bounds);
});

test('已有前景树用于第一次真实观测，下一次慢查询一致即可确认稳定', async () => {
  let calls = 0;
  const initial = [{ x: 0, y: 0, width: 492, height: 1329 }];
  await stableNativeObservation(async () => {
    calls++; await delay(10); return structuredClone(initial);
  }, (before, current) => assert.deepEqual(current, before), { initial, timeout: 1, interval: 0 });
  assert.equal(calls, 1);
});

test('慢查询得到真实位移仍失败，驱动错误和禁用状态不能被稳定性检查吞掉', async () => {
  let calls = 0;
  await assert.rejects(stableNativeObservation(async () => {
    await delay(10); return { x: calls++ };
  }, (before, current) => assert.deepEqual(current, before), { timeout: 1, interval: 0 }));
  const driverError = new Error('native query failed');
  await assert.rejects(stableNativeObservation(async () => { throw driverError; },
    () => {}, { interval: 0 }), error => error === driverError);
  await assert.rejects(stableNativeObservation(async () => ({ enabled: false }),
    (_before, current) => assert.equal(current.enabled, true), { timeout: 0, interval: 0 }));
});

test('布局真实变化后必须再等两份连续一致的观测', async () => {
  const sequence = [{ x: 0 }, { x: 10 }, { x: 20 }, { x: 20 }];
  let calls = 0;
  const actual = await stableNativeObservation(async () => sequence[calls++],
    (before, current) => assert.deepEqual(current, before), { interval: 0 });
  assert.equal(calls, 4);
  assert.deepEqual(actual, { x: 20 });
});

test('关闭后慢速原生缺失查询必须完成，连续两次缺失才确认关闭', async () => {
  let calls = 0;
  await stableNativeObservation(async () => {
    calls++; await delay(10); return null;
  }, (previous, current) => {
    assert.equal(previous, null);
    assert.equal(current, null);
  }, { timeout: 1, interval: 0 });
  assert.equal(calls, 2);
  await assert.rejects(stableNativeObservation(async () => ({ res: 'raise-bet-popup' }),
    (previous, current) => {
      assert.equal(previous, null);
      assert.equal(current, null);
    }, { timeout: 0, interval: 0 }));
});

test('重连恢复晚于布局预算时，重新取得两份连续一致的恢复后观测', async context => {
  let now = 100;
  context.mock.method(Date, 'now', () => now);
  const sequence = [
    { x: 10, recovered: false },
    { x: 20, recovered: true },
    { x: 30, recovered: false },
    { x: 30, recovered: false },
  ];
  let calls = 0;
  const compared = [];
  const result = await stableNativeObservation(async () => {
    if (calls === 1) now += 20;
    return sequence[calls++];
  }, (before, current) => {
    compared.push([before.x, current.x]);
    assert.equal(before.x, current.x);
  }, { timeout: 10, interval: 0, restartOn: current => current.recovered });
  assert.equal(calls, 4, '恢复后的单份观测不能直接作为稳定结果');
  assert.deepEqual(compared, [[20, 30], [30, 30]], '不能跨越重连比较旧布局');
  assert.equal(result.x, 30);
});

test('恢复后的真实位移仍受稳定预算约束，驱动错误继续传播', async () => {
  let calls = 0;
  await assert.rejects(stableNativeObservation(async () => ({
    x: calls++, recovered: calls === 2,
  }), (before, current) => assert.equal(before.x, current.x),
  { timeout: 0, interval: 0, restartOn: current => current.recovered }));
  const error = new Error('原生观测失败');
  await assert.rejects(stableNativeObservation(async () => {
    throw error;
  }, () => {}, { initial: {}, interval: 0, restartOn: () => true }), actual => actual === error);
});
