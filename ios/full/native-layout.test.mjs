import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { stableNativeTarget } from './navigation.ts';

// Actual Start now geometry from failed native run 39467404176.
const bounds = { height: 153, width: 451, x: 680, y: 2265 };
const node = (extra = {}) => ({ res: 'creat-room-button', bounds, enabled: true, ...extra });

test('首次树查询超过稳定性轮询预算，仍须再取一次真实布局才能通过', async () => {
  let reads = 0;
  const result = await stableNativeTarget({ info: async () => {
    reads++;
    await delay(20);
    return node();
  } }, 'creat-room-button', { timeout: 10, interval: 1 });
  assert.equal(reads, 2);
  assert.deepEqual(result.bounds, bounds);
});

test('位置改变后继续观察，直到相邻两次位置一致', async () => {
  let reads = 0;
  await stableNativeTarget({ info: async () => node({
    bounds: { ...bounds, y: ++reads === 1 ? 2200 : 2265 },
  }) }, 'creat-room-button', { timeout: 1000, interval: 1 });
  assert.equal(reads, 3);
});

test('持续移动或禁用的控件不能被稳定性检查接受', async () => {
  for (const disabled of [false, true]) {
    let reads = 0;
    await assert.rejects(stableNativeTarget({ info: async () => {
      await delay(20);
      return node({ enabled: !disabled, bounds: { ...bounds, y: disabled ? 2265 : ++reads } });
    } }, 'creat-room-button', { timeout: 10, interval: 1 }), disabled ? /应启用/ : /布局稳定/);
  }
});

test('控件树读取失败不能当成布局变化吞掉或继续点击', async () => {
  let reads = 0;
  const failure = new Error('XCTest source failed');
  await assert.rejects(stableNativeTarget({ info: async () => {
    if (++reads === 2) throw failure;
    return node();
  } }, 'creat-room-button', { interval: 1 }), error => error === failure);
  assert.equal(reads, 2);
});
