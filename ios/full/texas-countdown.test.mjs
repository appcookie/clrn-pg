import test from 'node:test';
import assert from 'node:assert/strict';
import { texasCountdownNodes, texasPlayerCountdown } from './texas-countdown.ts';
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
