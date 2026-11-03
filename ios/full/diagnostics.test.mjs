import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { safeNativeTree, safeFailureScreenshot, captureFailure } from './diagnostics.ts';
import { NativeCase } from './functional/shared/case.ts';

const bounds = { x: 5, y: 5, width: 4, height: 4 };
test('脱敏诊断保留当次可见性，隐藏子节点不能被误认为可见', () => {
  const [root] = safeNativeTree([{ res: 'panel', visible: true, children: [
    { res: 'chat-control', visible: false },
    { res: 'username-input', text: 'synthetic-secret', visible: true },
  ] }]);
  assert.equal(root.visible, true);
  assert.equal(root.children[0].visible, false);
  assert.equal(root.children[1].visible, true);
  assert.equal(JSON.stringify(root).includes('synthetic-secret'), false);
});
test('麦克风按钮不是电话号码，真实敏感输入及安全标记仍脱敏', () => {
  const mic = { res: 'in-game-audio-microphone-button', text: 'Hold to talk', bounds };
  const output = JSON.stringify(safeNativeTree([mic,
    { res: 'phone-number', text: 'synthetic-phone', bounds },
    { ...mic, secure: true, text: 'synthetic-secure' }]));
  assert.equal(output.includes('Hold to talk'), true);
  assert.equal(output.includes('synthetic-phone'), false);
  assert.equal(output.includes('synthetic-secure'), false);
  const png = new PNG({ width: 20, height: 20 }); png.data.fill(255);
  assert.deepEqual(PNG.sync.read(safeFailureScreenshot(PNG.sync.write(png), [mic])).data, png.data);
});
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
test('失败瞬间先采集脱敏传输快照，原生树读取失败仍保留关闭设备前的连接状态', async () => {
  const events = [], attachments = new Map();
  const snapshot = { websocket: { connections: [{ state: 'open', close: null }] } };
  await captureFailure({ nodes: async () => { events.push('读取原生树'); throw Error('驱动断开'); } },
    { attach: async (name, value) => { events.push('保存传输快照'); attachments.set(name, value); } },
    async () => { events.push('读取传输状态'); return snapshot; });
  assert.deepEqual(events, ['读取传输状态', '保存传输快照', '读取原生树']);
  assert.deepEqual(JSON.parse(attachments.get('failure-transport').body), snapshot);
});
test('传输快照读取失败时只记录不可用，不泄露错误正文或中断原有失败取证', async () => {
  const attachments = new Map();
  let reads = 0;
  await captureFailure({ nodes: async () => { reads++; throw Error('驱动断开'); } },
    { attach: async (name, value) => { attachments.set(name, value); } },
    async () => { throw Error('synthetic-credential'); });
  assert.equal(reads, 1, '传输诊断不可用时仍须尝试读取原生树');
  assert.deepEqual(JSON.parse(attachments.get('failure-transport').body), { unavailable: true });
  assert.equal(JSON.stringify([...attachments]).includes('synthetic-credential'), false);
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
