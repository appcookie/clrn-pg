// XCUITest XML 的真实可见性与 point/pixel 转换是所有原生业务断言的基础。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { parseNativeTree, NativeDevice, keyboardDismissTarget, normalizeNativeScreenshot } from './native-device.ts';
import { returnToTabs } from './navigation.ts';
test('原生截图只裁末尾一像素，保留每个内容像素，拒绝其他尺寸变化', () => {
  const source = new PNG({ width: 5, height: 7 });
  for (let i = 0; i < source.data.length; i++) source.data[i] = i;
  const bytes = PNG.sync.write(source);
  assert.equal(normalizeNativeScreenshot(bytes, { width: 5, height: 7 }), bytes);
  const size = { width: 4, height: 6 };
  const cropped = PNG.sync.read(normalizeNativeScreenshot(bytes, size));
  assert.deepEqual(size, { width: 4, height: 6 }, '截图裁边不能让pngjs默认选项污染设备屏幕尺寸');
  for (let y = 0; y < 6; y++) assert.deepEqual(cropped.data.subarray(y * 16, (y + 1) * 16), source.data.subarray(y * 20, y * 20 + 16));
  for (const size of [{ width: 3, height: 7 }, { width: 5, height: 8 }, { width: 0, height: 0 }]) {
    assert.throws(() => normalizeNativeScreenshot(bytes, size), /尺寸不匹配/);
  }
});
const xml = `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="App" enabled="true" visible="true" x="0" y="0" width="393" height="852">
<XCUIElementTypeButton name="confirm-button" label="Enter test version" enabled="false" visible="true" x="50" y="575" width="293" height="39"/>
<XCUIElementTypeSecureTextField name="password-input" value="••••" enabled="true" visible="true" x="50" y="503" width="293" height="49"/>
<XCUIElementTypeOther name="hidden" enabled="true" visible="false" x="0" y="0" width="393" height="852"/>
</XCUIElementTypeApplication></AppiumAUT>`;
test('解析保留控件ID/禁用/密码类型/隐藏状态，几何统一转换为截图像素', () => {
  const [root] = parseNativeTree(xml, { x: 3, y: 3 });
  assert.equal(root.children[0].res, 'confirm-button');
  assert.equal(root.children[0].enabled, false);
  assert.deepEqual(root.children[0].bounds, { x: 150, y: 1725, width: 879, height: 117 });
  assert.equal(root.children[1].secure, true);
  assert.equal(root.children[2].visible, false);
});
test('隐藏键盘不会点击 Return 或提交按钮中的文本', () => {
  const node = (clazz, text, y = 10, children = []) => ({ clazz, text, visible: true, enabled: true,
    bounds: { x: 0, y, width: 100, height: 20 }, children });
  const submit = node('XCUIElementTypeStaticText', 'Sign in');
  const button = node('XCUIElementTypeButton', 'Sign in', 10, [submit]);
  const key = node('XCUIElementTypeButton', 'Return', 400);
  const keyboard = node('XCUIElementTypeKeyboard', '', 300, [key]);
  assert.equal(keyboardDismissTarget([button, submit, keyboard, key]), undefined);
  const title = node('XCUIElementTypeStaticText', 'Welcome');
  assert.equal(keyboardDismissTarget([button, submit, keyboard, key, title]), title);
  key.text = 'Done';
  assert.equal(keyboardDismissTarget([button, submit, keyboard, key, title]), key);
});
test('隐藏命令返回成功但键盘仍可见时，安全点击后必须再次验证键盘消失', async () => {
  let keyboardVisible = true;
  const commands = [];
  const driver = {
    path: value => value,
    source: async () => `<AppiumAUT><XCUIElementTypeApplication enabled="true" visible="true" x="0" y="0" width="393" height="852">
      <XCUIElementTypeStaticText label="Welcome" enabled="true" visible="true" x="50" y="100" width="100" height="30"/>
      ${keyboardVisible ? '<XCUIElementTypeKeyboard enabled="true" visible="true" x="0" y="500" width="393" height="352"/>' : ''}
    </XCUIElementTypeApplication></AppiumAUT>`,
    request: async (_method, _path, command) => {
      commands.push(command);
      if (command.script === 'mobile: tap') keyboardVisible = false;
    },
  };
  const device = new NativeDevice(driver, 'test', async () => {}, async () => {}, 'test.app');
  device.screenSize = { width: 393, height: 852 };
  await device.hideKeyboard();
  assert.deepEqual(commands.map(command => command.script), ['mobile: hideKeyboard', 'mobile: tap']);
  assert.deepEqual(commands[1].args, [{ x: 100, y: 115 }]);
  assert.equal((await device.nodes()).some(node => node.clazz === 'XCUIElementTypeKeyboard'), false);
  // 安全点击也无效时，仍然必须失败，不能把命令返回值当作隐藏成功。
  keyboardVisible = true;
  driver.request = async () => {};
  device.setDefaultTimeout(1);
  await assert.rejects(device.hideKeyboard(), /等待控件消失超时/);
});
test('可见性查询不会将隐藏节点作为ready，驱动错误不会变成空树', async () => {
  const device = new NativeDevice({ source: async () => xml }, 'test', async () => {}, async () => {}, 'test.app');
  device.screenSize = { width: 393, height: 852 };
  assert.equal(await device.marker('hidden'), null);
  await assert.rejects(device.tap({ res: 'confirm-button' }), /禁用/);
  device.driver.source = async () => { throw new Error('WDA断开'); };
  await assert.rejects(device.marker('hidden'), /WDA断开/);
});

const backNode = (res, x = 30, extra = {}) => ({ res, clazz: 'XCUIElementTypeButton',
  visible: true, enabled: true, bounds: { x, y: 90, width: 60, height: 30 }, children: [], ...extra });
function backDevice(nodes) {
  const device = new NativeDevice({}, 'test', async () => {}, async () => {}, 'test.app');
  device.screenSize = { width: 1178, height: 2556 };
  const events = [];
  device.nodes = async () => { events.push('source'); return nodes; };
  device.input.tap = async point => { events.push(['tap', point]); };
  device.input.swipe = async gesture => { events.push(['swipe', gesture]); };
  device.hideKeyboard = async () => { events.push('dismiss-keyboard'); };
  return { device, events };
}
test('Back显式当前快照不读source，默认调用只读一次，并保持返回控件优先级', async () => {
  const nodes = [backNode('close-button', 600), backNode('back-button', 300), backNode('navigation-bar-back-button')];
  for (const supplied of [true, false]) {
    const { device, events } = backDevice(nodes);
    await device.input.press('Back', supplied ? nodes : undefined);
    assert.deepEqual(events, [...(supplied ? [] : ['source']), ['tap', { x: 60, y: 105 }]]);
  }
});
test('Back快照存在键盘时必须先收起键盘，不能点背后返回按钮', async () => {
  const nodes = [backNode('back-button'), backNode(undefined, 0, { clazz: 'XCUIElementTypeKeyboard' })];
  const { device, events } = backDevice(nodes);
  await device.input.press('Back', nodes);
  assert.deepEqual(events, ['dismiss-keyboard']);
});
test('Back保留原生返回文字兜底和无控件时的边缘手势', async () => {
  const { device, events } = backDevice([backNode(undefined, 30, { text: '返回上一頁' })]);
  await device.input.press('Back');
  assert.deepEqual(events, ['source', ['tap', { x: 60, y: 105 }]]);
  events.length = 0;
  await device.input.press('Back', []);
  assert.deepEqual(events, [['swipe', { x1: 2, y1: 1278, x2: 1178 * 0.85, y2: 1278, duration: 500 }]]);
});
test('Back和返回标签导航不会吞掉source错误或尝试盲点返回', async () => {
  const { device, events } = backDevice([]);
  const failure = new Error('WDA snapshot failed');
  device.nodes = async () => { throw failure; };
  await assert.rejects(device.input.press('Back'), error => error === failure);
  await assert.rejects(returnToTabs(device), error => error === failure);
  assert.deepEqual(events, []);
});
test('返回标签复用当前快照完成Back，动作后必须重新读取并确认真实标签页', async () => {
  const country = [backNode('back-button')];
  const tabs = [backNode('settings-tab')];
  const { device, events } = backDevice(country);
  let current = country;
  device.nodes = async () => { events.push(current === country ? 'country-source' : 'tabs-source'); return current; };
  device.input.tap = async point => { events.push(['tap', point]); current = tabs; };
  await returnToTabs(device);
  assert.deepEqual(events, ['country-source', ['tap', { x: 60, y: 105 }], 'tabs-source']);
});
