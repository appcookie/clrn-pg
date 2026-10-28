// 验证可见差异、动画帧变化和不同分辨率不会被视觉比较漏掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePixels, maximumChangedPixelRatio } from './visual.mjs';

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
test('仅忽略明确指定的系统 Home 指示条区域，页面差异仍失败', () => {
  const baseline = picture([80, 80, 80]);
  const actual = PNG.sync.read(baseline);
  for (let y = 18; y < 20; y++) for (let x = 5; x < 15; x++) {
    actual.data[(y * 20 + x) * 4] = 255;
  }
  const homeIndicator = { x: 5, y: 18, width: 10, height: 2 };
  assert.equal(comparePixels(baseline, PNG.sync.write(actual)).matches, false);
  assert.equal(comparePixels(baseline, PNG.sync.write(actual), 12, [homeIndicator]).matches, true);
  for (let x = 8; x < 11; x++) actual.data[(10 * 20 + x) * 4] = 255;
  assert.equal(comparePixels(baseline, PNG.sync.write(actual), 12, [homeIndicator]).matches, false);
});

function changedPicture(width, height, changedPixels, channelDifference = 13) {
  const picture = new PNG({ width, height });
  picture.data.fill(80);
  for (let pixel = 0; pixel < changedPixels; pixel++) picture.data[pixel * 4] += channelDifference;
  return PNG.sync.write(picture);
}

test('100×100 有效区域中 50 个超差像素通过，51 个失败', () => {
  assert.equal(maximumChangedPixelRatio, 0.005);
  const baseline = changedPicture(100, 100, 0);
  for (const changedPixels of [49, 50, 51]) {
    const comparison = comparePixels(baseline, changedPicture(100, 100, changedPixels));
    assert.equal(comparison.changedRatio, changedPixels / 10000);
    assert.equal(comparison.matches, changedPixels <= 50);
  }
});

test('每颜色通道容差仍为 12，局部截图按自身面积计算', () => {
  const baseline = changedPicture(20, 10, 0);
  assert.equal(comparePixels(baseline, changedPicture(20, 10, 200, 12)).matches, true);
  assert.equal(comparePixels(baseline, changedPicture(20, 10, 1)).matches, true);
  assert.equal(comparePixels(baseline, changedPicture(20, 10, 2)).matches, false);
});

test('显式排除与重叠排除按有效区域计算，全部排除不能通过', () => {
  const baseline = changedPicture(200, 100, 0);
  const exclusions = [{ x: 100, y: 0, width: 100, height: 100 }];
  for (const changedPixels of [50, 51]) {
    // 左上角一行的差异都位于未排除的 100×100 区域内。
    const actual = changedPicture(200, 100, changedPixels);
    for (const regions of [exclusions, [...exclusions, ...exclusions]]) {
      const comparison = comparePixels(baseline, actual, 12, regions);
      assert.equal(comparison.changedRatio, changedPixels / 10000);
      assert.equal(comparison.matches, changedPixels === 50);
    }
  }
  assert.equal(comparePixels(baseline, baseline, 12, [{ x: 0, y: 0, width: 200, height: 100 }]).matches, false);
});
