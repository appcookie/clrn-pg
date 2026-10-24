import test from 'node:test';
import assert from 'node:assert/strict';
import { modalBackgroundMasks } from './modal-background-masks.ts';
import { playerCountdown } from './game-countdown.ts';

const screen = { width: 1178, height: 2556 };
const timer = { res: 'texas-holdem-active-countdown', visible: false,
  bounds: { x: 401, y: 2103, width: 163, height: 162 } };
const player = { res: 'texas-holdem-player-container-self-operating', visible: false,
  bounds: { x: 401, y: 2040, width: 163, height: 291 }, children: [timer] };
const ping = { res: 'ping-screen-container', visible: false,
  bounds: { x: 986, y: 132, width: 192, height: 210 } };
const panel = { res: 'buy-in-application-list', visible: true,
  bounds: { x: 71, y: 789, width: 1036, height: 978 } };
const root = { bounds: { x: 0, y: 0, ...screen }, children: [player, ping, panel] };
const covers = (masks, x, y) => masks.some(b =>
  x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);

test('真实弹窗树仅恢复头像计时与右侧网络状态，不将隐藏节点用于操作就绪', () => {
  const masks = modalBackgroundMasks([root, panel], screen);
  assert.deepEqual(masks.map(({ reason, ...bounds }) => bounds), [
    { x: 399, y: 2101, width: 167, height: 166 },
    { x: 1013, y: 252, width: 150, height: 72 },
  ]);
  assert.throws(() => playerCountdown([player], 'self', 'texas-holdem'), /唯一/);
  assert.deepEqual(modalBackgroundMasks([player, ping], screen), []);
  assert.deepEqual(modalBackgroundMasks([timer, panel], screen), []);
});

test('覆盖计时器的前景文字和边框仍参与比较，重复树引用不扩大排除区域', () => {
  const covering = { ...panel, bounds: { x: 450, y: 2150, width: 300, height: 100 } };
  const nodes = [{ ...root, children: [player, ping, covering] }, player, covering];
  const masks = modalBackgroundMasks(nodes, screen);
  assert.equal(covers(masks, 470, 2190), false);
  assert.equal(covers(masks, 410, 2110), true);
  assert.equal(covers(masks, 600, 2200), false);
  assert.deepEqual(masks, modalBackgroundMasks([...nodes, player], screen));
});

test('越出所属玩家的时钟、偏离右侧锚点的网络节点不得扩大屏蔽', () => {
  const malformed = { ...player, children: [{ ...timer, bounds: { ...timer.bounds, width: 500 } }] };
  assert.throws(() => modalBackgroundMasks([malformed, panel], screen), /当前行动玩家/);
  assert.throws(() => modalBackgroundMasks([{ ...ping, bounds: { ...ping.bounds, x: 400 } }, panel], screen), /右侧锚点/);
});
