import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeViewport, fullyInside, pointInside } from './native-viewport.ts';
import { reveal, revealScenarioReady, tap, tapScenarioOption } from './navigation.ts';

function node(res, clazz, bounds, children = []) {
  return { res, clazz, bounds, children, visible: true, enabled: true, attributes: {} };
}
const screen = { x: 0, y: 0, width: 1178, height: 2556 };
function enteringGamePicker(settle = true, enabled = true, parentVisible = true) {
  const target = node('game-type-button-texas_six_plus', 'XCUIElementTypeOther',
    { x: 74, y: 2500, width: 1030, height: 150 });
  target.enabled = enabled;
  const heading = node('select-game-category-text', 'XCUIElementTypeStaticText',
    { x: 410, y: 1716, width: 358, height: 72 });
  const panel = node('Bottom Sheet', 'XCUIElementTypeOther',
    { x: 0, y: 1656, width: 1178, height: 1179 }, [heading, target]);
  panel.visible = parentVisible;
  const root = node('app', 'XCUIElementTypeApplication', screen, [panel]);
  let observations = 0;
  const points = [];
  const observe = async () => {
    if (++observations > 1 && settle) target.bounds.y = 2313;
    return [root, panel, heading, target];
  };
  const device = {
    screenSize: screen, waitSnapshot: observe, nodes: observe, hideKeyboard: async () => {},
    info: async (selector, snapshot) => (snapshot || await observe()).find(item => item.res === selector.res),
    input: { swipe: async () => { throw new Error('不得滚动背景列表'); }, tap: async point => points.push(point) },
  };
  return { device, target, points, observations: () => observations };
}

test('选择玩法等待底部面板的目标进入真实可点击视口，再执行单次点击', async () => {
  const value = enteringGamePicker();
  await tapScenarioOption(value.device, value.target.res, { interval: 1 });
  assert.ok(value.observations() >= 3);
  assert.deepEqual(value.points, [{ x: 589, y: 2388 }]);
});

test('选择面板持续被裁切、隐藏或禁用时仍失败，不滚背景或点击不可用目标', async () => {
  for (const args of [[false, true, true], [true, true, false], [true, false, true]]) {
    const value = enteringGamePicker(...args);
    await assert.rejects(tapScenarioOption(value.device, value.target.res, { timeout: 1, interval: 1 }), /未显示可点击目标/);
    assert.deepEqual(value.points, []);
  }
});

test('等待游戏选择面板期间驱动断连直接失败', async () => {
  const value = enteringGamePicker();
  const failure = new Error('driver disconnected');
  value.device.waitSnapshot = async () => { throw failure; };
  await assert.rejects(tapScenarioOption(value.device, value.target.res), error => error === failure);
});

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
  assert.equal(pointInside({ x: 589, y: 1810.5 }, result.viewport), false);
  assert.deepEqual(result.scrollables.map(item => item.node.res), ['modal-scroll']);
});

test('英文语言入口右侧溢出3px时点击可见中心；要求完整显示时仍拒绝', async () => {
  const button = node('switch-language-button', 'XCUIElementTypeOther', { x: 983, y: 264, width: 198, height: 54 });
  const root = node('app', 'XCUIElementTypeApplication', screen, [button]);
  const points = [];
  const device = {
    screenSize: { width: screen.width, height: screen.height },
    nodes: async () => [root, button], waitSnapshot: async () => [root, button], hideKeyboard: async () => {},
    info: async selector => {
      if (selector.res === button.res) return button;
      throw Object.assign(new Error('missing'), { code: 'no such element' });
    },
    input: { swipe: async () => { throw new Error('不应滚动可点击的语言入口'); }, tap: async point => points.push(point) },
  };
  assert.equal(fullyInside(button.bounds, screen), false);
  assert.equal(pointInside({ x: 1082, y: 291 }, screen), true);
  await tap(device, button.res);
  assert.deepEqual(points, [{ x: 1082, y: 291 }]);
  await assert.rejects(reveal(device, { res: button.res }, true), /控件被裁切且无可滚动祖先/);
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
    waitSnapshot: async () => tree.nodes, nodes: async () => tree.nodes, hideKeyboard: async () => {},
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

test('繁体游客登录弹窗按实际原生modal和准确文案就绪，不滚隐藏大厅挂载点', async () => {
  // Fifth real CI: the semantic mount remains inside the hidden hall, but the
  // visible prompt is rendered in a separate native modal subtree.
  const mount = node('game-matching-sign-in-popup', 'XCUIElementTypeOther', { x: 0, y: 1140, width: 1178, height: 2559 });
  const hall = node('hall', 'XCUIElementTypeScrollView', { x: 0, y: 291, width: 1178, height: 2016 }, [mount]);
  hall.visible = false;
  const message = node('pop-up-message-text', 'XCUIElementTypeStaticText', { x: 395, y: 1221, width: 388, height: 72 });
  message.text = '請登入後加入遊戲';
  const cancel = node('cancel-button', 'XCUIElementTypeOther', { x: 221, y: 1389, width: 343, height: 156 });
  const confirm = node('confirm-button', 'XCUIElementTypeOther', { x: 614, y: 1389, width: 343, height: 156 });
  const modal = node('popup-content-container', 'XCUIElementTypeOther', screen, [message, cancel, confirm]);
  const root = node('app', 'XCUIElementTypeApplication', screen, [hall, modal]);
  const visible = [root, modal, message, cancel, confirm];
  const queries = [];
  const lookup = selector => {
    const found = visible.find(item => item.visible && item.res === selector.res
      && (selector.text === undefined || item.text === selector.text)
      && (selector.enabled === undefined || item.enabled === selector.enabled));
    if (!found) throw Object.assign(new Error('missing'), { code: 'no such element' });
    return structuredClone(found);
  };
  const device = {
    screenSize: { width: screen.width, height: screen.height },
    nodes: async () => visible.filter(item => item.visible), info: async selector => lookup(selector),
    wait: async selector => { queries.push(selector); lookup(selector); }, hideKeyboard: async () => {},
    waitSnapshot: async selector => { queries.push(selector); lookup(selector); return visible.filter(item => item.visible); },
    input: { swipe: async () => { throw new Error('不应滚动隐藏的大厅'); } },
  };
  const scenario = { visualReadySelector: '[data-testid="game-matching-sign-in-popup"]', readyText: message.text };
  await revealScenarioReady(device, scenario);
  assert.ok(queries.some(query => query.res === message.res && query.text === message.text));
  assert.ok(queries.some(query => query.res === confirm.res && query.enabled === true));
  assert.ok(queries.some(query => query.res === cancel.res && query.enabled === true));
  assert.ok(queries.every(query => query.res !== mount.res));
  message.text = '其他提示';
  await assert.rejects(revealScenarioReady(device, scenario), /missing/);
  message.text = scenario.readyText;
  modal.visible = false;
  await assert.rejects(revealScenarioReady(device, scenario), /控件被裁切且无可滚动祖先/);
  modal.visible = true;
  confirm.enabled = false;
  await assert.rejects(revealScenarioReady(device, scenario), /missing/);
  confirm.enabled = true;
  confirm.bounds.y = 2520;
  await assert.rejects(revealScenarioReady(device, scenario), /控件被裁切且无可滚动祖先/);
});
