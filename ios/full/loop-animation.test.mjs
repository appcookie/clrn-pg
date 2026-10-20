import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { motionParts } = require('./motion-regions.ts');
const { changedMotionRegions } = require('./loop-animation.ts');
const { framePaletteDistance } = require('./loop-keyframes.ts');

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
