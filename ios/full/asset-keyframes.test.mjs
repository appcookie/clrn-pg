import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { assetKeyframes } from './asset-keyframes.ts';

function picture(colour, shift = 0, opacity = 1) {
  const png = new PNG({ width: 80, height: 80 });
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    const asset = colour !== undefined && x >= 20 + shift && x < 50 + shift && y >= 20 && y < 50;
    png.data.set([asset ? Math.round(40 + (colour - 40) * opacity) : 40, 60, 80, 255], (y * 80 + x) * 4);
  }
  return PNG.sync.write(png);
}

test('压缩视频的静态背景和单张素材闪现不能冒充两张播放相位', () => {
  const background = picture(), pose = picture(240);
  assert.throws(() => assetKeyframes([background, background, background]), /实际出现/);
  assert.throws(() => assetKeyframes([background, pose, pose, background]), /实际变化/);
  // The old absolute >2 filter could select this nearly disappeared pose.
  assert.throws(() => assetKeyframes([background, pose, pose, picture(240, 0, 0.25), background]), /实际变化/);
});

test('两张真正可见且有动作的素材关键帧通过，第二张不能选消失背景', () => {
  const frames = [picture(), picture(240), picture(240, 8), picture(240, 0, 0.25), picture()];
  const result = assetKeyframes(frames);
  assert.equal(result.peak.index, 1);
  assert.equal(result.changed.index, 2);
  assert.deepEqual(result.visible.map(item => item.index), [1, 2]);
});
