import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { challengeRegion } from './challenge-region.ts';
import { motionParts, samePixels } from './motion-regions.ts';

test('真实录像中AX右边界外的一列绿框归入动画分区，全部前景仍比较', () => {
  const frames = ['light', 'dark'].map(name => readFileSync(new URL(`./fixtures/zhajinhua-challenge-edge/${name}.png`, import.meta.url)));
  const bounds = { x: 0, y: 0, width: 11, height: 64 }, screen = { width: 17, height: 64 };
  const old = frames.map(frame => motionParts(frame, [bounds]));
  assert.equal(samePixels(old[0].outside, old[1].outside), false, '旧边界把闪烁的一列算成不稳定背景');
  const corrected = frames.map(frame => motionParts(frame, [challengeRegion(bounds, screen)]));
  assert.equal(samePixels(corrected[0].outside, corrected[1].outside), true);
  assert.equal(samePixels(corrected[0].regions[0], corrected[1].regions[0]), false, '动画像素仍在前景分区中，不能被遮掉');
});
test('绘制余量保持整数像素并限制在真实屏幕内', () => {
  assert.deepEqual(challengeRegion({ x: 29, y: 951, width: 202, height: 294 }, { width: 1178, height: 2556 }),
    { x: 27, y: 949, width: 206, height: 298 });
  assert.deepEqual(challengeRegion({ x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }),
    { x: 0, y: 0, width: 10, height: 10 });
});
