import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { slotBackgroundMasks, slotHeadReference, transparentBackgroundMasks, verifySlotHeadGeometry } from './slot-background.ts';
import { maskScreenshot } from './screenshot.ts';
import { samePixels } from './motion-regions.ts';

test('背景排除只在独立横幅内，保留实心前景；原始截图不被修改', () => {
  const head = new PNG({ width: 40, height: 40 });
  for (let y = 5; y < 35; y++) for (let x = 15; x < 25; x++) head.data[(y * 40 + x) * 4 + 3] = 255;
  const banner = { x: 75, y: 75, width: 50, height: 20 };
  const masks = transparentBackgroundMasks(head, { x: 80, y: 80, width: 40, height: 40 }, banner);
  assert.ok(masks.length);
  assert.ok(masks.every(m => m.x >= banner.x && m.y >= banner.y
    && m.x + m.width <= banner.x + banner.width && m.y + m.height <= banner.y + banner.height));
  const picture = new PNG({ width: 200, height: 200 }); picture.data.fill(255);
  const baseline = PNG.sync.write(picture);
  picture.data.fill(0, (76 * 200 + 76) * 4, (76 * 200 + 76) * 4 + 3);
  const changedBackground = PNG.sync.write(picture);
  assert.equal(samePixels(changedBackground, baseline), false);
  assert.equal(samePixels(maskScreenshot(changedBackground, masks), maskScreenshot(baseline, masks)), true);
  picture.data.fill(0, (90 * 200 + 100) * 4, (90 * 200 + 100) * 4 + 3);
  assert.equal(samePixels(maskScreenshot(PNG.sync.write(picture), masks), maskScreenshot(baseline, masks)), false,
    '头部实心前景回归不能被当成后台横幅变化');
  assert.equal(PNG.sync.read(changedBackground).data[(76 * 200 + 76) * 4], 0);
});

test('头部素材或原生位置变化必须失败，不能用新轮廓悄悄扩大背景遮罩', () => {
  assert.throws(() => slotBackgroundMasks(Buffer.from('changed artwork'),
    { x: 0, y: 0, width: 10, height: 10 }), /素材已变化/);
  const head = { res: slotHeadReference.asset, bounds: { ...slotHeadReference.bounds } };
  verifySlotHeadGeometry([head]);
  assert.throws(() => verifySlotHeadGeometry([]), /弹窗头部未出现/);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.throws(() => verifySlotHeadGeometry([{ ...head, bounds: { ...head.bounds, [key]: head.bounds[key] + 1 } }]), /布局偏离/);
  }
});
