// 使用真实失败报告的原生边界回归验证遮罩点击位置。
import test from 'node:test';
import assert from 'node:assert/strict';
import { gameMaskPoint } from './game-mask-point.ts';
const screen = { width: 1178, height: 2556 };
const mask = { x: 0, y: 0, ...screen };
test('买入申请关闭点落在面板外的可交互牌桌，避开旧的状态栏 y=80', () => {
  const point = gameMaskPoint(mask, { x: 71, y: 789, width: 1036, height: 978 }, screen);
  assert.ok(point.y > 180 && point.y < 2446);
  assert.ok(point.y < 710 || point.y > 1850); // 真实外层面板比列表标记更大。
  assert.ok(point.x > 71 && point.x < 1107);
});
test('满高抽屉从右侧空白关闭，底部面板从上方空白关闭', () => {
  assert.ok(gameMaskPoint(mask, { x: 0, y: 0, width: 500, height: 2556 }, screen).x > 500);
  const point = gameMaskPoint(mask, { x: 0, y: 1800, width: 1178, height: 756 }, screen);
  assert.ok(point.y > 180 && point.y < 1800);
});
test('内容完全覆盖遮罩时拒绝猜测点击位置', () => {
  assert.throws(() => gameMaskPoint(mask, mask, screen), /没有.*可点击区域/);
});
