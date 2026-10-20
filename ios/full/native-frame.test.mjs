import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { decodeFrame, encodeFrame } from './native-frame.ts';
import { cropMotionRegion, cropNativeFrame } from './motion-regions.ts';
import { nativeTransitionEvidence, transitionEvidence } from './animation-transition.ts';

test('原生 PNG 编解码保留全部 RGBA 字节，包括透明像素里的颜色', async () => {
  const p = new PNG({ width: 73, height: 127 });
  for (let i = 0; i < p.data.length; i++) p.data[i] = (i * 53 + Math.floor(i / 17)) % 256;
  const encoded = PNG.sync.write(p), decoded = await decodeFrame(encoded);
  assert.deepEqual(decoded.data, p.data);
  assert.deepEqual(PNG.sync.read(await encodeFrame(decoded)).data, p.data);
  const real = readFileSync('ios/snapshots/v1/help/share/ios-share-sheet-enter/ios/iphone16-ios18.5/en/animation/end.png');
  assert.deepEqual((await decodeFrame(real)).data, PNG.sync.read(real).data);
});

test('原生裁图保留原遮罩规则、越界与面积阻断，逐像素等同原实现', async () => {
  const p = new PNG({ width: 120, height: 180 });
  for (let i = 0; i < p.data.length; i++) p.data[i] = i % 256;
  const bytes = PNG.sync.write(p), region = { x: 20, y: 30, width: 70, height: 90 };
  const masks = [
    { x: 19.5, y: 31.2, width: 11.8, height: 17.3, reason: 'partial crop' },
    { x: 105, y: 150, width: 6, height: 8, reason: 'outside crop' },
    { x: 25, y: 35, width: 20, height: 20, reason: 'unverified', unverifiedLayout: true },
  ];
  assert.deepEqual(PNG.sync.read(await cropNativeFrame(bytes, region, masks)).data,
    PNG.sync.read(cropMotionRegion(bytes, region, masks)).data);
  await assert.rejects(cropNativeFrame(bytes, region,
    [{ x: 0, y: 0, width: 120, height: 180, reason: 'oversized' }]), /12%/);
  await assert.rejects(cropNativeFrame(bytes, { ...region, x: 80 }), /超出/);
  await assert.rejects(cropNativeFrame(bytes, { ...region, y: 0.5 }), /超出/);
});

test('全部帧的原生分析与原实现得到完全相同的距离、候选序号及像素', async () => {
  const frames = Array.from({ length: 21 }, (_, index) => {
    const p = new PNG({ width: 91, height: 133 });
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      p.data.set(y > 130 - index * 5 && x > 20 ? [180, x, y, 255] : [10, 30, 40, 255],
        (y * p.width + x) * 4);
    }
    return PNG.sync.write(p);
  });
  assert.deepEqual(await nativeTransitionEvidence(frames[0], frames.at(-1), frames),
    transitionEvidence(frames[0], frames.at(-1), frames, 'videoFrames'));
  assert.deepEqual(await nativeTransitionEvidence(frames[0], frames[0], [frames[0], frames[0]]),
    transitionEvidence(frames[0], frames[0], [frames[0], frames[0]], 'videoFrames'));
});
