// XCUITest XML 的真实可见性与 point/pixel 转换是所有原生业务断言的基础。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { parseNativeTree, NativeDevice, keyboardDismissTarget, normalizeNativeScreenshot } from './native-device.ts';
test('原生截图只裁末尾一像素，保留每个内容像素，拒绝其他尺寸变化', () => {
  const source = new PNG({ width: 5, height: 7 });
  for (let i = 0; i < source.data.length; i++) source.data[i] = i;
  const bytes = PNG.sync.write(source);
  assert.equal(normalizeNativeScreenshot(bytes, { width: 5, height: 7 }), bytes);
  const cropped = PNG.sync.read(normalizeNativeScreenshot(bytes, { width: 4, height: 6 }));
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
test('可见性查询不会将隐藏节点作为ready，驱动错误不会变成空树', async () => {
  const device = new NativeDevice({ source: async () => xml }, 'test', async () => {}, async () => {}, 'test.app');
  device.screenSize = { width: 393, height: 852 };
  assert.equal(await device.marker('hidden'), null);
  await assert.rejects(device.tap({ res: 'confirm-button' }), /禁用/);
  device.driver.source = async () => { throw new Error('WDA断开'); };
  await assert.rejects(device.marker('hidden'), /WDA断开/);
});
