import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { timedPromptEvidence } from './animation-transition.ts';
const layout = { title: { x: 4, y: 2, width: 12, height: 5 }, timer: { x: 1, y: 9, width: 3, height: 3 } };
function frame(show = true, seconds = 100, titleShift = 0, unrelated = 0) {
  const png = new PNG({ width: 20, height: 14 });
  for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) {
    const heading = show && x >= 4 + titleShift && x < 16 + titleShift && y >= 2 && y < 7;
    const timer = show && x >= 1 && x < 4 && y >= 9 && y < 12;
    const value = heading ? 220 : timer ? seconds : (y === 13 ? unrelated : 0);
    png.data.set([value, value, value, 255], (y * 20 + x) * 4);
  }
  return PNG.sync.write(png);
}
test('稳定标题配合真实秒数区域变化才能形成升级倒计时关键帧', () => {
  const before = frame(false), first = frame(true, 100), changed = frame(true, 180);
  const result = timedPromptEvidence(before, [before, first, changed], layout);
  assert.ok(result.pair);
  assert.deepEqual(result.pair.first, first);
  assert.deepEqual(result.pair.changed, changed);
});
test('冻结秒数、无关背景变化和仍在滑入的标题都不能冒充倒计时', () => {
  const before = frame(false);
  assert.equal(timedPromptEvidence(before, [frame(), frame()], layout).pair, undefined);
  assert.equal(timedPromptEvidence(before, [frame(), frame(true, 100, 0, 255)], layout).pair, undefined);
  assert.equal(timedPromptEvidence(before, [frame(), frame(true, 180, 2)], layout).pair, undefined);
});
