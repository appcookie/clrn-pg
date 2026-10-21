/** 用真实端点像素验证网络差异隔离，并确保牌谱正文及边缘不会被遮罩。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { reviewEndpointNetworkMasks } from './review-endpoint-masks.ts';
import { maskScreenshot } from './screenshot.ts';
import { samePixels } from './motion-regions.ts';

const screen = { width: 1178, height: 2556 };
const ping = { res: 'ping-screen-container', visible: true,
  bounds: { x: 986, y: 132, width: 192, height: 210 } };
const provenance = JSON.parse(readFileSync(new URL('./fixtures/review-endpoint-ping/provenance.json', import.meta.url)));
const fixture = name => {
  const frame = new PNG(screen);
  frame.data.fill(255);
  const bytes = readFileSync(new URL(`./fixtures/review-endpoint-ping/${name}.png`, import.meta.url));
  const source = provenance.sources.find(item => item.file === `${name}.png`);
  assert.ok(source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  const crop = PNG.sync.read(bytes);
  PNG.bitblt(crop, frame, 0, 0, crop.width, crop.height, ping.bounds.x, ping.bounds.y);
  return PNG.sync.write(frame);
};
const covers = (masks, x, y) => masks.some(b => x >= b.x && x < b.x + b.width
  && y >= b.y && y < b.y + b.height);

test('真实33ms/40ms差异只在无遮挡网络状态内排除，原片保持原样', () => {
  const reference = fixture('baseline-ping'), current = fixture('current-ping');
  const preserved = Buffer.from(current);
  const masks = reviewEndpointNetworkMasks([ping, ping], screen);
  assert.equal(masks.length, 1);
  assert.deepEqual(masks.map(({ reason, ...b }) => b), [{ x: 1013, y: 252, width: 150, height: 72 }]);
  assert.equal(samePixels(reference, current), false);
  assert.equal(samePixels(maskScreenshot(reference, masks), maskScreenshot(current, masks)), true);
  assert.deepEqual(current, preserved);
  const changed = PNG.sync.read(current);
  changed.data[(240 * screen.width + 1040) * 4] = 0;
  assert.equal(samePixels(maskScreenshot(reference, masks),
    maskScreenshot(PNG.sync.write(changed), masks)), false);
});

test('完整牌谱及其最外边缘必须参与比较，部分覆盖只排除剩余背景', () => {
  const panel = { res: 'base-review-board-container', visible: true,
    bounds: { x: 248, y: 0, width: 930, height: 2556 } };
  assert.deepEqual(reviewEndpointNetworkMasks([ping, panel], screen), []);
  const partial = { ...panel, bounds: { x: 1050, y: 280, width: 128, height: 600 } };
  const masks = reviewEndpointNetworkMasks([ping, partial], screen);
  assert.equal(covers(masks, 1049, 280), true);
  assert.equal(covers(masks, 1050, 280), false);
  assert.equal(covers(masks, 1162, 323), false);
  const original = fixture('baseline-ping'), changed = PNG.sync.read(original);
  changed.data[(280 * screen.width + 1050) * 4] = 255;
  assert.equal(samePixels(maskScreenshot(original, masks),
    maskScreenshot(PNG.sync.write(changed), masks)), false);
});

test('不恢复隐藏网络节点，也不接受失去原生锚点的任意大区域', () => {
  assert.deepEqual(reviewEndpointNetworkMasks([{ ...ping, visible: false }], screen), []);
  assert.deepEqual(reviewEndpointNetworkMasks([], screen), []);
  assert.throws(() => reviewEndpointNetworkMasks([{ ...ping,
    bounds: { ...ping.bounds, x: 400 } }], screen), /右侧锚点/);
  assert.throws(() => reviewEndpointNetworkMasks([{ ...ping,
    bounds: { ...ping.bounds, height: 800 } }], screen), /右侧锚点/);
  assert.throws(() => reviewEndpointNetworkMasks([{ ...ping,
    bounds: { ...ping.bounds, x: 0, width: screen.width } }], screen), /右侧锚点/);
  assert.throws(() => reviewEndpointNetworkMasks([{ ...ping,
    bounds: { ...ping.bounds, y: 132.5 } }], screen), /右侧锚点/);
  assert.throws(() => reviewEndpointNetworkMasks([ping, { ...ping,
    bounds: { ...ping.bounds, y: 133 } }], screen), /一个物理/);
  assert.deepEqual(reviewEndpointNetworkMasks([ping, { ...ping, bounds: { ...ping.bounds } }], screen),
    reviewEndpointNetworkMasks([ping], screen));
});
