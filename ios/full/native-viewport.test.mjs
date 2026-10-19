import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeViewport, fullyInside } from './native-viewport.ts';
import { tap } from './navigation.ts';

function node(res, clazz, bounds, children = []) {
  return { res, clazz, bounds, children, visible: true, enabled: true, attributes: {} };
}
const screen = { x: 0, y: 0, width: 1178, height: 2556 };
function stagingTree() {
  // Actual zh-Hans CI geometry: the button center (1810.5) lies below the scroll viewport (1803).
  const button = node('confirm-button', 'XCUIElementTypeButton', { x: 149, y: 1752, width: 880, height: 117 });
  const scroll = node('modal-scroll', 'XCUIElementTypeScrollView', { x: 77, y: 834, width: 1024, height: 969 }, [button]);
  const sibling = node('background-list', 'XCUIElementTypeScrollView', screen);
  const root = node('app', 'XCUIElementTypeApplication', screen, [sibling, scroll]);
  return { button, scroll, nodes: [root, sibling, scroll, button] };
}

test('真实CI按钮虽然在屏幕内，仍必须按祖先滚动viewport判定被裁切', () => {
  const { button, scroll, nodes } = stagingTree();
  assert.equal(fullyInside(button.bounds, screen), true);
  const result = nativeViewport(nodes, structuredClone(button), screen);
  assert.deepEqual(result.viewport, scroll.bounds);
  assert.equal(result.visibleBounds.height, 51);
  assert.equal(fullyInside(button.bounds, result.viewport), false);
  assert.deepEqual(result.scrollables.map(item => item.node.res), ['modal-scroll']);
});

test('嵌套滚动区必须取全部祖先交集，不能只判断最近滚动容器', () => {
  const button = node('nested', 'XCUIElementTypeButton', { x: 100, y: 550, width: 100, height: 50 });
  const inner = node('inner', 'XCUIElementTypeScrollView', { x: 80, y: 300, width: 400, height: 600 }, [button]);
  const outer = node('outer', 'XCUIElementTypeScrollView', { x: 70, y: 200, width: 500, height: 300 }, [inner]);
  const result = nativeViewport([outer, inner, button], button, screen);
  assert.deepEqual(result.viewport, { x: 80, y: 300, width: 400, height: 200 });
  assert.equal(result.visibleBounds.height, 0);
  assert.equal(fullyInside(button.bounds, result.viewport), false);
});

test('通用tap先在真实祖先内滑动，再以新布局位置点击；不滚背景列表', async () => {
  const tree = stagingTree(), events = [];
  const device = {
    screenSize: { width: screen.width, height: screen.height },
    wait: async () => {}, nodes: async () => tree.nodes, hideKeyboard: async () => {},
    info: async selector => {
      const found = tree.nodes.find(node => node.res === selector.res);
      if (!found) throw Object.assign(new Error('missing'), { code: 'no such element' });
      return structuredClone(found);
    },
    input: {
      swipe: async gesture => {
        events.push('swipe');
        for (const y of [gesture.y1, gesture.y2]) assert.ok(y >= 834 && y <= 1803);
        assert.ok(gesture.x1 >= 77 && gesture.x1 <= 1101);
        tree.button.bounds.y = 1552;
      },
      tap: async point => { events.push('tap'); assert.deepEqual(point, { x: 589, y: 1610.5 }); },
    },
  };
  await tap(device, 'confirm-button');
  assert.deepEqual(events, ['swipe', 'tap']);
});
