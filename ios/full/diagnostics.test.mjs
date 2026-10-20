import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { safeNativeTree, safeFailureScreenshot, captureFailure } from './diagnostics.ts';
import { NativeCase } from './functional/shared/case.ts';

const bounds = { x: 5, y: 5, width: 4, height: 4 };
test('扁平重复子节点、匿名输入和祖先聚合文本都不泄漏，普通文字保留', () => {
  const child = { clazz: 'XCUIElementTypeTextField', res: 'synthetic-account', text: 'synthetic-account', bounds };
  const nested = { res: 'username-input', text: 'synthetic-account', bounds, children: [child] };
  const root = { res: 'screen', text: 'synthetic-account', children: [nested, { clazz: 'XCUIElementTypeKeyboard', children: [{ res: 'synthetic-account', text: 'synthetic-account' }] }, { res: 'hall-title', text: 'Hall' }] };
  const output = JSON.stringify(safeNativeTree([root, nested, child]));
  assert.equal(output.includes('synthetic-account'), false);
  assert.equal(output.includes('Hall'), true);
});
test('失败截图遮住敏感容器和匿名输入，保留区域外原像素；未知边界拒绝输出', () => {
  const png = new PNG({ width: 20, height: 20 }); png.data.fill(255);
  const input = { clazz: 'XCUIElementTypeTextField', bounds };
  const result = PNG.sync.read(safeFailureScreenshot(PNG.sync.write(png), [input]));
  assert.deepEqual([...result.data.subarray((6 * 20 + 6) * 4, (6 * 20 + 6) * 4 + 4)], [32, 32, 32, 255]);
  assert.deepEqual([...result.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.throws(() => safeFailureScreenshot(PNG.sync.write(png), [{ res: 'password-input' }]), /边界/);
  assert.throws(() => safeFailureScreenshot(PNG.sync.write(png), []), /无障碍树/);
});
test('无法读取原生树时绝不保存无脱敏截图', async () => {
  let screenshot = false, attached = false;
  await captureFailure({ nodes: async () => { throw Error('disconnected'); }, nativeScreenshot: async () => { screenshot = true; } },
    { attach: async () => { attached = true; } });
  assert.equal(screenshot, false); assert.equal(attached, false);
});
test('子树匹配排除隐藏父节点下的行', async () => {
  const item = (visible) => ({ res: 'row', visible, bounds });
  const ui = new NativeCase({ screenSize: { width: 20, height: 20 } }, {});
  ui.node = async () => ({ res: 'list', visible: true, children: [item(true), item(false), { visible: false, children: [item(true)] }] });
  assert.equal((await ui.within('list', 'row')).length, 1);
});
test('输入凭据时失败也关闭应用并丢弃原始错误内容', async () => {
  let terminated = false;
  const ui = new NativeCase({ terminate: async () => { terminated = true; throw Error('terminate unavailable'); } }, {});
  ui.loginForm = async () => {}; ui.fill = async () => { throw Error('synthetic-credential'); };
  await assert.rejects(ui.signIn({ username: 'synthetic-account', password: 'synthetic-password' }), error =>
    error.message.includes('原生真实登录') && !error.message.includes('synthetic'));
  assert.equal(terminated, true);
});
test('独立模拟器进入大厅失败仍关闭该设备并保留原始失败', async () => {
  let closed = false;
  const failure = Error('hall unavailable');
  const ui = new NativeCase({}, {});
  await assert.rejects(ui.secondary(async options => {
    assert.equal(options.isolated, true);
    return { wait: async () => { throw failure; }, close: async () => { closed = true; } };
  }), error => error === failure);
  assert.equal(closed, true);
});
