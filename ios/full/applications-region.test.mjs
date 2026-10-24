import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeApplicationsPanelBounds } from './applications-region.ts';
import { animationRegion } from './animation-region.ts';

const screen = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
// Native tree from run 39531480973: the inner list excluded the thick frame.
const list = node('buy-in-application-list', { x: 71, y: 789, width: 1036, height: 978 });
const card = node(undefined, { x: 47, y: 708, width: 1084, height: 1140 });
const wrappers = [node('screen-mask-touch-to-close', { x: 0, y: 0, ...screen }),
  node(undefined, { x: 71, y: 789, width: 1036, height: 1188 }), node(undefined, list.bounds)];

test('申请动画保留完整外框，不能把列表、超长滚动容器或全屏遮罩当卡片', () => {
  const nodes = [list, ...wrappers, card];
  const bounds = { x: 43, y: 704, width: 1092, height: 1148 };
  assert.deepEqual(nativeApplicationsPanelBounds(nodes, screen), bounds);
  for (const game of ['texas-holdem', 'zhajinhua']) for (const phase of ['enter', 'exit']) {
    assert.deepEqual(animationRegion(`${game}-buy-in-applications-${phase}`,
      phase === 'exit' ? nodes : [], phase === 'enter' ? nodes : [], { screenSize: screen }, {}),
    { bounds, source: 'native-complete-applications-card' });
  }
  assert.throws(() => nativeApplicationsPanelBounds([list, ...wrappers], screen), /完整原生卡片/);
  assert.throws(() => nativeApplicationsPanelBounds([card], screen), /唯一可见原生列表/);
  assert.throws(() => nativeApplicationsPanelBounds([card, { ...list, visible: false }], screen), /唯一可见原生列表/);
  assert.throws(() => nativeApplicationsPanelBounds([card, list, list], screen), /唯一可见原生列表/);
  assert.throws(() => nativeApplicationsPanelBounds([list, { ...card, visible: false }, ...wrappers], screen), /完整原生卡片/);
});
