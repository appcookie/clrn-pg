import test from 'node:test';
import assert from 'node:assert/strict';
import { slotReelRegions } from './slot-regions.ts';

test('老虎机按真实 iOS 裁剪窗口识别三个滚轮，排除屏幕外长条图案与单行容器', () => {
  const symbols = [281, 506, 731].flatMap(x => [1176, 1356, 1536, 1716, 1896].map(y => ({
    res: 'assets/slot_item_coin@3x.png', bounds: { x, y, width: 154, height: 150 }, children: [],
  })));
  const row = { bounds: { x: 236, y: 1341, width: 679, height: 180 }, children: symbols };
  const window = { bounds: { x: 218, y: 1344, width: 724, height: 534 }, children: [row] };
  const screen = { bounds: { x: 0, y: 0, width: 1178, height: 2556 }, children: [window] };
  const actual = slotReelRegions([screen, window, row, ...symbols]);
  assert.deepEqual(slotReelRegions([screen]), actual, '保留真实裁剪父节点，即使该容器本身不单独可访问');
  assert.deepEqual(actual.window, window.bounds);
  assert.deepEqual(actual.reels, [281, 506, 731].map(x => ({ x, y: 1344, width: 154, height: 534 })));
  assert.throws(() => slotReelRegions([{ ...window, children: symbols.filter(s => s.bounds.x !== 731) }]), /三个/);
});
