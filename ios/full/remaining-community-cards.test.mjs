import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { remainingCardsBackgroundMasks, remainingCardsOverlayRatio } from './remaining-community-cards.ts';

const rect = (x, y, width, height) => ({ x, y, width, height });
const node = (res, text, bounds) => ({ res, text, bounds, visible: true, enabled: true });
test('preparing background masks preserves room clock, network status, and active countdown', () => {
  const nodes = [
    node('ping-screen-container', '', rect(970, 200, 200, 140)),
    node('game-network-proxy-code', '0', rect(1079, 2496, 52, 48)),
    node('texas-holdem-active-countdown', '', rect(48, 1387, 164, 166)),
  ];
  const masks = remainingCardsBackgroundMasks(nodes, { width: 1178, height: 2556 });
  assert.deepEqual(masks.map(mask => mask.reason), [
    '网络延迟数值、图标与前后端延迟比例条', 'game-network-proxy-code',
    'texas-holdem-active-countdown 含两像素绘制边缘',
  ]);
});

test('simulator screenshots recognize the modal region without treating table changes elsewhere as a popup', () => {
  const base = new PNG({ width: 300, height: 600 });
  base.data.fill(100);
  const outside = PNG.sync.read(PNG.sync.write(base));
  for (let y = 400; y < 500; y++) for (let x = 20; x < 280; x++)
    outside.data[(y * outside.width + x) * 4] = 5;
  assert.equal(remainingCardsOverlayRatio(base, outside), 0);
  const modal = PNG.sync.read(PNG.sync.write(base));
  for (let y = 105; y < 210; y++) for (let x = 60; x < 240; x++)
    modal.data[(y * modal.width + x) * 4] = 5;
  assert.ok(remainingCardsOverlayRatio(base, modal) > .12);
});
