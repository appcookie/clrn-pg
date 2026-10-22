import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { gameLoadingRegions } from './game-loading-region.ts';
import { captureMovingKeyframes } from './loop-keyframes.ts';
const screen = { width: 1178, height: 2556 };
const image = (file, bounds) => ({ clazz: 'XCUIElementTypeImage', res: `/assets/${file}@3x.png`, bounds, children: [] });
test('加载范围由稳定父容器确定，不跟随旋转图片的外接矩形缩放', () => {
  for (const size of [180, 246]) {
    const circle = image('icon_loading_circle', { x: 589 - size / 2, y: 1240 - size / 2, width: size, height: size });
    const spade = image('icon_loading_spade', { x: 574, y: 1195, width: 30, height: 90 });
    const panel = { clazz: 'XCUIElementTypeOther', bounds: { x: 499, y: 1150, width: 180, height: 180 }, children: [circle, spade] };
    const actual = gameLoadingRegions([panel, circle, spade], screen);
    const root = { clazz: 'XCUIElementTypeOther', bounds: { x: 0, y: 0, ...screen }, children: [panel] };
    assert.deepEqual(gameLoadingRegions([root, circle, spade], screen), actual,
      '稳定容器未出现在 XCTest 可见平铺列表中时仍从当前图片的真实祖先取几何');
    assert.deepEqual(actual.ring, { x: 495, y: 1146, width: 188, height: 188 });
    assert.deepEqual(actual.spade, { x: 540, y: 1191, width: 98, height: 98 });
    assert.deepEqual(gameLoadingRegions([circle, spade], screen), actual,
      'Fabric 省略纯布局父容器时从两张实际同中心图片恢复相同范围');
    for (const bounds of [
      { x: 439, y: 1090, width: 300, height: 300 },
      { ...panel.bounds, x: panel.bounds.x + 10 },
    ]) assert.deepEqual(gameLoadingRegions([{ ...panel, bounds }], screen), actual,
      '更大或偏移的共同祖先不能扩大或移动加载截图范围');
    for (const wrong of [
      { ...spade, bounds: { ...spade.bounds, x: spade.bounds.x + 20 } },
      { ...spade, bounds: { ...spade.bounds, height: 50 } },
      { ...spade, bounds: { ...spade.bounds, width: 120 } },
    ]) assert.throws(() => gameLoadingRegions([circle, wrong], screen), /旋转几何/);
  }
  assert.throws(() => gameLoadingRegions([], screen), /同时看到/);
});

test('旋转图片的两像素水平取整不会移动由同一原生 Loading 文字定位的裁图', () => {
  const label = { clazz: 'XCUIElementTypeStaticText', res: 'Loading',
    bounds: { x: 500, y: 1383, width: 178, height: 54 }, children: [] };
  const layout = (panelX, circleBounds, spadeBounds) => {
    const circle = image('icon_loading_circle', circleBounds);
    const spade = image('icon_loading_spade', spadeBounds);
    const panel = { clazz: 'XCUIElementTypeOther',
      bounds: { x: panelX, y: 1142, width: 186, height: 186 }, children: [circle, spade] };
    return [panel, circle, spade, label, { ...label }];
  };
  const first = gameLoadingRegions(layout(498,
    { x: 476, y: 1122, width: 226, height: 225 },
    { x: 545, y: 1188, width: 91, height: 93 }), screen);
  const last = gameLoadingRegions(layout(496,
    { x: 494, y: 1140, width: 190, height: 189 },
    { x: 542, y: 1188, width: 94, height: 93 }), screen);
  assert.deepEqual(first, last);
  assert.deepEqual(first.ring, { x: 492, y: 1138, width: 194, height: 194 });
});

test('只有黑桃变化不能冒充圆环旋转，只有圆环变化也不能代替黑桃运动', async () => {
  const previous = process.env.IOS_VISUAL_MODE; process.env.IOS_VISUAL_MODE = 'smoke';
  const ring = { x: 30, y: 30, width: 20, height: 20 }, spade = { x: 36, y: 36, width: 8, height: 8 };
  const mask = { ...spade, reason: 'independently checked center' };
  const frame = (outer, inner) => {
    const p = new PNG({ width: 90, height: 90 }); p.data.fill(0);
    for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
    for (const b of [outer ? { x: 30, y: 30, width: 20, height: 4 } : null, inner ? spade : null].filter(Boolean)) {
      for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) {
        p.data.set([255, 255, 255, 255], (y * 90 + x) * 4);
      }
    }
    return PNG.sync.write(p).toString('base64');
  };
  const samples = (outer, inner) => Array.from({ length: 10 }, (_, i) => ({
    capturedAt: i * 100, png: i < 5 ? frame(false, false) : frame(outer, inner),
  }));
  const info = { attach: async () => {} };
  const run = (region, frames, masks = []) => captureMovingKeyframes({}, 'synthetic-loading', info,
    [region], 18, undefined, 1, [], frames, masks);
  try {
    await assert.rejects(run(ring, samples(false, true), [mask]), /必须运动/);
    await assert.rejects(run(spade, samples(true, false)), /必须运动/);
    await run(ring, samples(true, true), [mask]);
    await run(spade, samples(true, true));
    await assert.rejects(captureMovingKeyframes({}, 'synthetic-loading', info,
      [ring], 18, undefined, 2, [], samples(true, true)), /只能分析一次/);
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE; else process.env.IOS_VISUAL_MODE = previous;
  }
});
