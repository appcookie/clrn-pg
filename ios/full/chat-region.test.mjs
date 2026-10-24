import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeChatPanelBounds, animationRegion } from './animation-region.ts';
import { gameMaskPoint } from './game-mask-point.ts';
const screenSize = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
// Run 39509484466: hidden root made the old "gone" check pass while chat remained open.
const panel = node(undefined, { x: 0, y: 1803, width: 1178, height: 753 });
const controls = [
  node('in-game-chat-send-message', { x: 926, y: 1845, width: 211, height: 135 }),
  node('-in-game-chat-record-tab', { x: 389, y: 2004, width: 178, height: 153 }),
  node('in-game-chat-content-container', { x: 41, y: 2139, width: 1096, height: 381 }),
];
test('聊天裁图覆盖输入、标签和内容，关闭点位于面板上方且避开状态栏', () => {
  const nodes = [panel, ...controls];
  assert.deepEqual(nativeChatPanelBounds(nodes, screenSize), panel.bounds);
  const point = gameMaskPoint({ x: 0, y: 0, ...screenSize }, panel.bounds, screenSize);
  assert.ok(point.y > 180 && point.y < 1803);
  assert.deepEqual(animationRegion('zhajinhua-chat-enter', [], nodes, { screenSize }, {}).bounds, panel.bounds);
  assert.deepEqual(animationRegion('texas-holdem-chat-exit', nodes, [], { screenSize }, {}).bounds, panel.bounds);
});
test('缺少真实可见聊天内容或完整容器时拒绝继续采样', () => {
  assert.throws(() => nativeChatPanelBounds(controls, screenSize), /完整聊天/);
  assert.throws(() => nativeChatPanelBounds([panel, ...controls.slice(0, 2)], screenSize), /缺少可见/);
  assert.throws(() => nativeChatPanelBounds([panel, ...controls.map(n => ({ ...n, visible: false }))], screenSize), /缺少可见/);
});
