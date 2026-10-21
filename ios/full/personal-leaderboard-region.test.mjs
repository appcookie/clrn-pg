import test from 'node:test';
import assert from 'node:assert/strict';
import { animationRegion, nativePersonalLeaderboardBounds } from './animation-region.ts';
const screenSize = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, clazz: 'XCUIElementTypeOther', visible: true });
// Actual native geometry from 39515987750; the legacy root identifier is hidden.
const panel = node(undefined, { x: 0, y: 0, width: 930, height: 2556 });
const controls = [
  node('personal-leader-board-nickname', { x: 392, y: 633, width: 145, height: 54 }),
  node('personal-leader-board-round', { x: 0, y: 804, width: 930, height: 63 }),
  node('personal-leader-board-profit', { x: 0, y: 894, width: 930, height: 63 }),
  node('personal-leader-board-close-button', { x: 767, y: 2334, width: 103, height: 105 }),
];
test('个人排行榜裁图包含完整左侧栏，不能使用裁掉左侧的旧固定区域', () => {
  const nodes = [panel, ...controls];
  assert.deepEqual(nativePersonalLeaderboardBounds(nodes, screenSize), panel.bounds);
  for (const phase of ['enter', 'exit']) {
    assert.deepEqual(animationRegion(`texas-holdem-personal-leaderboard-${phase}`,
      phase === 'exit' ? nodes : [], phase === 'enter' ? nodes : [], { screenSize }, {}).bounds, panel.bounds);
  }
});
test('个人排行榜缺数据或只有全屏遮罩时失败', () => {
  assert.throws(() => nativePersonalLeaderboardBounds([panel, ...controls.slice(1)], screenSize), /缺少可见/);
  assert.throws(() => nativePersonalLeaderboardBounds([node(undefined, { x: 0, y: 0, ...screenSize }), ...controls],
    screenSize), /完整个人/);
});
