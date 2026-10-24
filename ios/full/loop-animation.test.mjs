import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { motionParts } = require('./motion-regions.ts');
const { changedMotionRegions } = require('./loop-animation.ts');
const { framePaletteDistance, captureLoopKeyframes } = require('./loop-keyframes.ts');

test('原生骨架共享三像素边界时保留两个完整图，各自冻结仍会失败', async () => {
  const regions = [{ x: 0, y: 0, width: 20, height: 13 }, { x: 0, y: 10, width: 20, height: 13 }];
  const samples = freezeSecond => Array.from({ length: 10 }, (_, index) => {
    const picture = new PNG({ width: 20, height: 23 });
    for (let y = 0; y < 23; y++) for (let x = 0; x < 20; x++) {
      const value = y >= 10 && y < 13 ? 255 : y >= 13 && freezeSecond ? 50 : index % 2 ? 90 : 50;
      picture.data.set([value, value, value, 255], (y * 20 + x) * 4);
    }
    return { capturedAt: index * 40, png: PNG.sync.write(picture).toString('base64') };
  });
  const saved = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const images = [];
  const info = { attach: async (name, data) => {
    if (name.endsWith('.png')) images.push(PNG.sync.read(data.body));
  } };
  try {
    await captureLoopKeyframes({}, 'club-list-skeleton', info, regions, 1, samples(false));
    assert.equal(images.length, 4);
    assert.ok(images.every(image => image.width === 20 && image.height === 13));
    await assert.rejects(captureLoopKeyframes({}, 'club-list-skeleton', info, regions, 1, samples(true)), /第 2 个占位控件必须脉动/);
    await assert.rejects(captureLoopKeyframes({}, 'club-list-skeleton', info,
      [regions[0], { ...regions[1], y: 9 }], 1, samples(false)), /不能重叠/);
    await assert.rejects(captureLoopKeyframes({}, 'club-list-skeleton', info,
      [regions[0], regions[0]], 1, samples(false)), /不能重叠/);
  } finally {
    if (saved === undefined) delete process.env.IOS_VISUAL_MODE; else process.env.IOS_VISUAL_MODE = saved;
  }
});

/**
 * 构造两个动画区和一个非动画区的真实 PNG 像素分区。
 * @param left - 左侧动画灰度。
 * @param right - 右侧动画灰度。
 * @param outside - 非动画区域灰度。
 */
function parts(left, right, outside = 0) {
  const png = new PNG({ width: 6, height: 2 });
  for (let y = 0; y < 2; y++) for (let x = 0; x < 6; x++) {
    const offset = (y * 6 + x) * 4;
    png.data.fill(x < 2 ? left : x < 4 ? right : outside, offset, offset + 3);
    png.data[offset + 3] = 255;
  }
  return motionParts(PNG.sync.write(png), [
    { x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 0, width: 2, height: 2 },
  ]).regions;
}

test('背景变化不能冒充动画，且每个目标区分别验证', () => {
  const first = parts(0, 0);
  assert.deepEqual(changedMotionRegions(first, parts(0, 0, 255)), [false, false]);
  assert.deepEqual(changedMotionRegions(first, parts(255, 0)), [true, false]);
  assert.deepEqual(changedMotionRegions(first, parts(0, 255)), [false, true]);
  assert.throws(() => changedMotionRegions(first, parts(0, 0).slice(0, 1)), /数量/);
});

test('旋转控件保留亮点分布，缺失亮点不能匹配基准', () => {
  /** 生成同尺寸、不同亮点位置的局部屏幕。
   * @param lit - 亮点像素坐标。
   */
  const frame = lit => {
    const png = new PNG({ width: 10, height: 10 });
    for (let pixel = 0; pixel < 100; pixel++) {
      const bright = lit.includes(pixel);
      png.data.fill(bright ? 240 : 12, pixel * 4, pixel * 4 + 3);
      png.data[pixel * 4 + 3] = 255;
    }
    return PNG.sync.write(png);
  };
  assert.equal(framePaletteDistance(frame([11, 12, 13]), frame([51, 52, 53])), 0);
  assert.ok(framePaletteDistance(frame([11, 12, 13]), frame([])) > 2);
});
