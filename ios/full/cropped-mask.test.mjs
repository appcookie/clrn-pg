import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { maskScreenshot, maskCroppedScreenshot } from './screenshot.ts';
import { cropMotionRegion } from './motion-regions.ts';

function scene() {
  const picture = new PNG({ width: 100, height: 200 }); picture.data.fill(255);
  const full = PNG.sync.write(picture), region = { x: 10, y: 20, width: 20, height: 40 };
  return { full, region, cropped: cropMotionRegion(full, region), masks: [{ x: 12, y: 22, width: 15, height: 20, reason: '原生倒计时' }] };
}

test('裁图内37.5%的原生倒计时仍只占全屏1.5%，全屏遮罩后裁切与局部基准结果逐像素一致', () => {
  const { full, region, cropped, masks } = scene();
  assert.throws(() => maskScreenshot(cropped, masks.map(m => ({ ...m, x: m.x - region.x, y: m.y - region.y }))), /12%/);
  const actual = maskCroppedScreenshot(cropped, full, masks, region);
  const expected = cropMotionRegion(maskScreenshot(full, masks), region);
  assert.deepEqual(PNG.sync.read(actual).data, PNG.sync.read(expected).data);
  const output = PNG.sync.read(actual);
  assert.deepEqual([...output.data.subarray(0, 4)], [255, 255, 255, 255], '未遮罩前景保持原像素');
});
test('大于全屏12%的遮罩即使裁图内只看到小部分也必须失败', () => {
  const { full, region, cropped } = scene();
  assert.throws(() => maskCroppedScreenshot(cropped, full,
    [{ x: 0, y: 0, width: 100, height: 25, reason: '过大' }], region), /12%/);
});
test('拒绝尺寸错配与全屏外范围，未校准遮罩仍不生效', () => {
  const { full, region, cropped, masks } = scene();
  for (const wrong of [{ ...region, x: 90 }, { ...region, width: 19 }, { ...region, y: -1 }])
    assert.throws(() => maskCroppedScreenshot(cropped, full, masks, wrong), /真实裁图范围/);
  assert.deepEqual(PNG.sync.read(maskCroppedScreenshot(cropped, full,
    masks.map(mask => ({ ...mask, unverifiedLayout: true })), region)).data, PNG.sync.read(cropped).data);
});
