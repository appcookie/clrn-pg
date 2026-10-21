import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { loadingWindow } from './loading-window.ts';

const label = { x: 2, y: 2, width: 4, height: 4 };
function picture(value) {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([value, value, value, 255], i);
  return PNG.sync.write(png);
}
const before = picture(20), loaded = picture(200);
const frame = (value, index) => ({ capturedAt: index * 180, png: picture(value).toString('base64') });

test('只剔除真实加载文字出现前的连续预热帧，保留原帧与原始编码时戳', async () => {
  const frames = [frame(20, 0), frame(20, 1), ...Array.from({ length: 12 }, (_, i) => frame(200, i + 2))];
  const result = await loadingWindow(frames, before, loaded, label);
  assert.equal(result.first, 2);
  assert.deepEqual(result.frames, frames.slice(2));
  assert.equal(result.frames[0], frames[2]);
  assert.equal(result.frames[0].capturedAt, 360);
});

test('拒绝缺少加载、加载中断、超时末帧和不足一个周期的录像', async () => {
  const frames = Array.from({ length: 12 }, (_, i) => frame(200, i));
  await assert.rejects(loadingWindow(frames, loaded, loaded, label), /请求前/);
  await assert.rejects(loadingWindow(frames.map((_, i) => frame(20, i)), before, loaded, label), /连续/);
  for (const index of [5, 11]) {
    const broken = frames.slice(); broken[index] = frame(20, index);
    await assert.rejects(loadingWindow(broken, before, loaded, label), /连续/);
  }
  await assert.rejects(loadingWindow(frames.slice(0, 9), before, loaded, label), /十帧/);
  await assert.rejects(loadingWindow(frames.map((f, i) => ({ ...f, capturedAt: i * 100 })), before, loaded, label), /完整旋转周期/);
});
