import test from 'node:test';
import assert from 'node:assert/strict';
import { closeGameMask } from './game-pregame.ts';

const screenSize = { width: 1178, height: 2556 };
const mask = { res: 'screen-mask-touch-to-close', visible: true, enabled: true,
  bounds: { x: 0, y: 0, ...screenSize } };
const drawer = { res: 'drawer-menu-item-exit', visible: true, enabled: true,
  bounds: { x: 0, y: 795, width: 492, height: 135 } };

function deviceAfter(closeOnTap) {
  const taps = [];
  return { taps, screenSize,
    nodes: async () => taps.length >= closeOnTap ? [] : [mask, drawer],
    input: { tap: async point => { taps.push(point); } },
  };
}

test('遮罩首次点击关闭时只点击一次', async () => {
  const device = deviceAfter(1);
  await closeGameMask(device, drawer.res);
  assert.equal(device.taps.length, 1);
});

test('真实抽屉和遮罩首次点击后都仍在时，仅再点击一次并要求关闭', async () => {
  const device = deviceAfter(2);
  await closeGameMask(device, drawer.res);
  assert.equal(device.taps.length, 2);
  assert.deepEqual(device.taps[1], device.taps[0]);
});
