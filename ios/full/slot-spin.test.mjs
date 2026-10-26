import test from 'node:test';
import assert from 'node:assert/strict';
import { pressVerifiedSlotSpin } from './slot-spin.ts';

const bounds = x => ({ x, y: 20, width: 30, height: 40 });
const button = x => ({ res: 'spin-button', bounds: bounds(x), visible: true, enabled: true });

function fixture(onTap) {
  let reads = 0;
  const taps = [];
  return {
    taps,
    device: {
      screenSize: { width: 120, height: 180 },
      prepareTransientCapture: async () => {},
      inputObservation: async () => [button(++reads === 1 ? 10 : 50)],
      nodes: async () => { throw new Error('不得复用录屏前的原生树'); },
      input: { tap: async point => { taps.push(point); await onTap(); } },
    },
  };
}

test('旋转录屏开始后读取稳定的新位置，只点击一次并确认请求计数', async () => {
  let spins = 3;
  const value = fixture(() => { spins++; });
  await pressVerifiedSlotSpin(value.device, async () => spins, 3);
  assert.deepEqual(value.taps, [{ x: 65, y: 40 }]);
  assert.equal(spins, 4);
});

test('代理未收到旋转请求时保留失败，不重复点击', async () => {
  const value = fixture(() => {});
  await assert.rejects(pressVerifiedSlotSpin(value.device, async () => 3, 3, 1),
    /代理未收到旋转请求/);
  assert.equal(value.taps.length, 1);
});

test('旋转前请求计数已变化时不得点击', async () => {
  const value = fixture(() => {});
  await assert.rejects(pressVerifiedSlotSpin(value.device, async () => 4, 3),
    /旋转前代理请求计数与预期不符/);
  assert.equal(value.taps.length, 0);
});
