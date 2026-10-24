import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReviewPanelBounds, animationRegion } from './animation-region.ts';
import { gameMaskPoint } from './game-mask-point.ts';
const screenSize = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
// Run 39509653750: the old y=80 tap lands in the status bar; the sheet remains open.
const panel = node(undefined, { x: 248, y: 0, width: 930, height: 2556 });
const controls = [
  node('review-board-description-text', { x: 599, y: 1104, width: 229, height: 54 }),
  node('review-board-slider', { x: 413, y: 2259, width: 601, height: 120 }),
  node('review-board-share-button', { x: 1019, y: 2361, width: 130, height: 114 }),
];
test('空牌谱动画完整覆盖实际侧栏，关闭点在左侧可交互遮罩', () => {
  const nodes = [panel, ...controls];
  assert.deepEqual(nativeReviewPanelBounds(nodes, screenSize), panel.bounds);
  const point = gameMaskPoint({ x: 0, y: 0, ...screenSize }, panel.bounds, screenSize);
  assert.ok(point.x > 16 && point.x < 248 && point.y > 180 && point.y < 2446);
  for (const game of ['texas-holdem', 'zhajinhua']) {
    assert.deepEqual(animationRegion(`${game}-game-record-enter`, [], nodes, { screenSize }, {}).bounds, panel.bounds);
    assert.deepEqual(animationRegion(`${game}-game-record-exit`, nodes, [], { screenSize }, {}).bounds, panel.bounds);
  }
});
test('只存在说明文本或全屏遮罩时拒绝猜测侧栏范围', () => {
  assert.throws(() => nativeReviewPanelBounds(controls, screenSize), /完整原生/);
  assert.throws(() => nativeReviewPanelBounds([panel, controls[0]], screenSize), /缺少可见/);
});
