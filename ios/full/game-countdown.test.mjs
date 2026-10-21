import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { playerCountdownNodes, playerCountdown } from './game-countdown.ts';
import { countdownShapeDistance } from './game-countdown-capture.ts';
const texasCountdownNodes = nodes => playerCountdownNodes(nodes, 'texas-holdem');
const texasPlayerCountdown = (nodes, id) => playerCountdown(nodes, id, 'texas-holdem');
const bounds = { x: 401, y: 2103, width: 163, height: 162 };
const timer = { res: 'texas-holdem-active-countdown', visible: false, bounds,
  children: [{ text: '90', bounds, children: [{ text: '90', bounds }] }] };
const player = { res: 'texas-holdem-player-container-self-operating', visible: true,
  bounds: { x: 401, y: 2040, width: 163, height: 291 }, children: [timer] };
test('从当前可见行动玩家读取 XCTest 隐藏包装中的完整倒计时', () => {
  assert.deepEqual(texasPlayerCountdown([player], 'self'), { node: timer, seconds: 90 });
  assert.deepEqual(texasCountdownNodes([player, timer]), [timer]);
});
test('拒绝孤立计时器、错误玩家、零秒、冲突秒数以及裁出玩家边界的计时器', () => {
  assert.throws(() => texasPlayerCountdown([timer], 'self'), /唯一/);
  assert.throws(() => texasPlayerCountdown([{ ...player, visible: false }], 'self'), /唯一/);
  assert.throws(() => texasPlayerCountdown([player], 'other'), /唯一/);
  for (const children of [[{ text: '0', bounds }], [{ text: '9', bounds }, { text: '8', bounds }]]) {
    assert.throws(() => texasPlayerCountdown([{ ...player, children: [{ ...timer, children }] }], 'self'), /正数秒数/);
  }
  assert.throws(() => texasCountdownNodes([{ ...player, children: [
    { ...timer, bounds: { ...bounds, width: 300 } },
  ] }]), /完整位于/);
});
test('拼三张倒计时保留头像外的三像素绘制边缘，仍限定当前行动玩家', () => {
  const zTimer = { ...timer, res: 'zhajinhua-active-countdown',
    bounds: { x: 398, y: 2100, width: 169, height: 168 } };
  const zPlayer = { ...player, res: 'zhajinhua-player-container-self-operating', children: [zTimer] };
  assert.equal(playerCountdown([zPlayer], 'self', 'zhajinhua').node, zTimer);
  assert.throws(() => playerCountdown([zPlayer], 'self', 'texas-holdem'), /唯一/);
  assert.throws(() => playerCountdown([{ ...zPlayer, children: [{ ...zTimer,
    bounds: { ...zTimer.bounds, x: 390 } }] }], 'self', 'zhajinhua'), /完整位于/);
});

test('倒计时忽略变化的数字，只兼容黄绿扇形，缺失或变蓝仍失败', () => {
  const frame = (color, digit = 70) => {
    const png = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const inSweep = x >= 4 && x < 12 && y < 4;
      const inDigit = x >= 5 && x < 11 && y >= 6 && y < 10;
      png.data.set(inSweep ? color : inDigit ? [digit, digit, digit, 255] : [70, 70, 70, 255],
        (y * 16 + x) * 4);
    }
    return PNG.sync.write(png);
  };
  const yellow = frame([255, 220, 20, 255]);
  assert.equal(countdownShapeDistance(yellow, frame([0, 220, 120, 255], 255)), 0);
  assert.ok(countdownShapeDistance(yellow, frame([70, 70, 70, 255])) > 10);
  assert.ok(countdownShapeDistance(yellow, frame([30, 60, 245, 255])) > 10);
});
