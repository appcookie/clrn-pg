import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
const require = createRequire(import.meta.url);
const { cropMotionRegion, motionParts, samePixels } = require('./motion-regions.ts');
const regions = [{ x: 0, y: 0, width: 4, height: 4 }, { x: 4, y: 0, width: 4, height: 4 }];

test('录屏裁图优化保持原始 RGBA 与旧路径 PNG 字节完全一致，不缩放或重绘', () => {
  const picture = new PNG({ width: 101, height: 87 });
  for (let i = 0; i < picture.data.length; i++) picture.data[i] = (i * 31 + Math.floor(i / 11)) % 256;
  const bytes = PNG.sync.write(picture);
  for (const region of [{ x: 3, y: 7, width: 33, height: 45 }, { x: 0, y: 0, width: 101, height: 87 }]) {
    assert.deepEqual(cropMotionRegion(bytes, region), motionParts(bytes, [region]).regions[0]);
  }
  for (const region of [{ x: -1, y: 0, width: 5, height: 5 }, { x: 0, y: 0, width: 102, height: 87 },
    { x: 0, y: 0, width: 0, height: 1 }, { x: 0.5, y: 0, width: 2, height: 2 }]) {
    assert.throws(() => cropMotionRegion(bytes, region), /超出实际截图/);
  }
});

/**
 * 构造两个独立动画区域和一个静态下半屏，用明显色差验证没有漏比较的像素。
 * @param left - 左侧动画灰度。
 * @param right - 右侧动画灰度。
 * @param outside - 静态区域灰度。
 */
function frame(left, right, outside = 255) {
  const picture = new PNG({ width: 8, height: 8 });
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = (y * 8 + x) * 4;
    picture.data.fill(y < 4 ? x < 4 ? left : right : outside, offset, offset + 3);
    picture.data[offset + 3] = 255;
  }
  return PNG.sync.write(picture);
}

test('独立闪烁可分时匹配，静态区域和每个玩家区域都不能漏掉', () => {
  const expected = motionParts(frame(0, 255), regions);
  const first = motionParts(frame(0, 0), regions);
  const second = motionParts(frame(255, 255), regions);
  assert.equal(samePixels(first.outside, expected.outside), true);
  assert.equal(samePixels(first.regions[0], expected.regions[0]), true);
  assert.equal(samePixels(first.regions[1], expected.regions[1]), false);
  assert.equal(samePixels(second.regions[1], expected.regions[1]), true);
  const badPlayer = motionParts(frame(0, 80), regions);
  assert.equal(samePixels(badPlayer.regions[1], expected.regions[1]), false);
  const badOutside = motionParts(frame(0, 255, 0), regions);
  assert.equal(samePixels(badOutside.outside, expected.outside), false);
});

test('动画分区不能重叠或越界，完整帧尺寸变化仍导致失败', () => {
  assert.throws(() => motionParts(frame(0, 255), [regions[0], regions[0]]), /不能重叠/);
  assert.throws(() => motionParts(frame(0, 255), [{ x: 7, y: 7, width: 2, height: 2 }]), /超出/);
  assert.equal(samePixels(frame(0, 255), PNG.sync.write(new PNG({ width: 9, height: 8 }))), false);
});

test('稳定和基准比较都容许单色阶绘制抖动，但一个真实变化像素也不能漏掉', () => {
  const expected = frame(80, 80, 80);
  assert.equal(samePixels(frame(81, 81, 81), expected), true);
  const changed = PNG.sync.read(expected);
  changed.data.fill(255, (4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 3);
  assert.equal(samePixels(PNG.sync.write(changed), expected), false);
});
