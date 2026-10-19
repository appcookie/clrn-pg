// 验证可见差异、动画帧变化和不同分辨率不会被视觉比较漏掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePixels } from './visual.mjs';

const picture = (color, width = 20) => {
  const png = new PNG({ width, height: 20 });
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set([...color, 255], offset);
  return PNG.sync.write(png);
};
test('截图容忍轻微编码误差，但拒绝明显视觉变化和尺寸变化', () => {
  const baseline = picture([80, 80, 80]);
  assert.equal(comparePixels(baseline, baseline).matches, true);
  assert.equal(comparePixels(baseline, picture([82, 82, 82])).matches, true);
  const changed = comparePixels(baseline, picture([255, 80, 80]));
  assert.equal(changed.matches, false);
  assert.equal(changed.changedRatio, 1);
  assert.ok(changed.diff);
  assert.equal(comparePixels(baseline, picture([80, 80, 80], 21)).matches, false);
});
test('动态基准中的变化帧能识别冻结动画', () => {
  const baseline = [picture([0, 0, 0]), picture([255, 0, 0])];
  const frozen = [baseline[0], baseline[0]];
  assert.equal(baseline.every((frame, index) => comparePixels(frame, frozen[index]).matches), false);
});
