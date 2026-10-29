import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePixels } from '../visual.mjs';
import { compareAnimationEndpoint } from './animation-endpoint.ts';
import { compareTexasActionStart } from './texas-action-start.ts';
import { compareShowdownStart } from './zhajinhua-showdown.ts';
import { cropMotionRegion } from './motion-regions.ts';
import { compareScreenshot } from './device.ts';

function picture(changedPixels) {
  const image = new PNG({ width: 200, height: 100 });
  image.data.fill(80);
  // 差异都位于左侧有效区域；右侧模拟原有的倒计时排除区域。
  for (let pixel = 0; pixel < changedPixels; pixel++) image.data[pixel * 4] = 93;
  return PNG.sync.write(image);
}

test('整图、局部终点和两种倒计时起点共用 0.5% 边界', () => {
  const region = { x: 0, y: 0, width: 200, height: 100 };
  const timer = { x: 100, y: 0, width: 100, height: 100 };
  const retained = { x: 0, y: 0, width: 100, height: 100 };
  const baseline = picture(0);
  const croppedBaseline = cropMotionRegion(baseline, retained);
  for (const changedPixels of [50, 51]) {
    const actual = picture(changedPixels);
    const cropped = cropMotionRegion(actual, retained);
    const expected = changedPixels === 50;
    assert.equal(comparePixels(baseline, actual, 12, [timer]).matches, expected);
    assert.equal(compareAnimationEndpoint(cropped, [{ name: '已审查局部终点', bytes: croppedBaseline }]).matches, expected);
    assert.equal(compareTexasActionStart(actual, baseline, { region, timer }).samePixels, expected);
    assert.equal(compareShowdownStart(actual, baseline, { region, timer }).samePixels, expected);
  }
});

test('截图稳定性允许 0.5% 内的连续绘制抖动，并使用最终比较的排除区域', async () => {
  const previousMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  let screenshots = 0;
  const attachments = [];
  try {
    await compareScreenshot({}, '比例边界稳定性', {
      attach: async name => attachments.push(name),
    }, { transientState: async () => {}, takeScreenshot: async () => {
      if (++screenshots > 10) throw new Error('0.5% 内的抖动不应反复重置稳定计时');
      return picture(screenshots % 2 === 0 ? 50 : 0);
    }, comparisonExclusions: [{ x: 100, y: 0, width: 100, height: 100 }] });
    assert.ok(screenshots >= 3);
    assert.ok(attachments.includes('比例边界稳定性.png'));
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});
