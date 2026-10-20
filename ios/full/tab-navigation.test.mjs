import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGuestSettingsTab } from './navigation.ts';

const node = (res, bounds, extra = {}) => ({ res, clazz: 'XCUIElementTypeOther', visible: true,
  enabled: true, children: [], bounds, ...extra });
const full = { x: 0, y: 291, width: 1178, height: 2016 };
const tab = node('settings-tab', { x: 941, y: 2307, width: 237, height: 147 }, { clazz: 'XCUIElementTypeButton' });
const hall = [node('hall-content-list', full), tab];
// From the real 11d2816 Chinese account-page tree, rather than a Web screen ID.
const login = node('sign-in-button', { x: 74, y: 318, width: 169, height: 138 });
const settings = [node('settings-list', { x: 0, y: 60, width: 1178, height: 2247 }), login, tab];
function fixture(snapshots) {
  let taps = 0;
  const device = { screenSize: { width: 1178, height: 2556 }, nodes: async () => snapshots[Math.min(taps - 1, snapshots.length - 1)] };
  const options = { timeout: 0, tapTab: async () => { taps++; } };
  return { device, options, taps: () => taps };
}

test('首次标签点击已进入真实我的页时不重试', async () => {
  const f = fixture([settings]);
  await selectGuestSettingsTab(f.device, f.options);
  assert.equal(f.taps(), 1);
});
test('目标页面延迟出现时继续观察首次点击，不提前重试', async () => {
  const f = fixture([settings]);
  let reads = 0;
  f.device.nodes = async () => ++reads === 1 ? hall : settings;
  await selectGuestSettingsTab(f.device, { ...f.options, timeout: 1000 });
  assert.equal(reads, 2);
  assert.equal(f.taps(), 1);
});
test('首次标签点击未生效且仍在无遮挡大厅时只重试一次真实点击', async () => {
  const f = fixture([hall, settings]);
  await selectGuestSettingsTab(f.device, f.options);
  assert.equal(f.taps(), 2);
});
test('第二次仍停大厅明确失败，不反复点击或滚动错误页面', async () => {
  const f = fixture([hall]);
  await assert.rejects(selectGuestSettingsTab(f.device, f.options), /未显示可操作/);
  assert.equal(f.taps(), 2);
});
test('原生错误、键盘、原生sheet或已知应用模态不能被重试掩盖', async () => {
  for (const overlay of [
    node(undefined, full, { clazz: 'XCUIElementTypeAlert' }),
    node(undefined, full, { clazz: 'XCUIElementTypeKeyboard' }),
    node(undefined, full, { clazz: 'XCUIElementTypeSheet' }),
    node('popup-content-container', full), node('html-render', full), node('alert-message-text', full),
  ]) {
    const f = fixture([[...hall, overlay], settings]);
    await assert.rejects(selectGuestSettingsTab(f.device, f.options), /错误弹窗、键盘或其他模态/);
    assert.equal(f.taps(), 1);
  }
});
test('隐藏/裁切/禁用登录控件不是目标页就绪；其他页面和不可操作标签不能重试', async () => {
  const clipped = node('clip', { x: 0, y: 500, width: 1178, height: 400 },
    { clazz: 'XCUIElementTypeScrollView', children: [login] });
  for (const nodes of [
    [settings[0], { ...login, visible: false }, tab],
    [settings[0], { ...login, enabled: false }, tab],
    [settings[0], clipped, login, tab],
    [tab],
    [hall[0], { ...tab, enabled: false }],
    [hall[0], { ...tab, bounds: { ...tab.bounds, y: 2700 } }],
  ]) {
    const f = fixture([nodes]);
    await assert.rejects(selectGuestSettingsTab(f.device, f.options), /未显示可操作/);
    assert.equal(f.taps(), 1);
  }
});
test('阻挡节点和页面容器必须在屏幕及真实祖先viewport内可见', async () => {
  const alert = node(undefined, full, { clazz: 'XCUIElementTypeAlert' });
  const hidden = node('hidden-host', full, { visible: false, children: [alert] });
  for (const extra of [[hidden, alert], [node('popup-content-container', { ...full, y: 3000 })]]) {
    const f = fixture([[...settings, ...extra]]);
    await selectGuestSettingsTab(f.device, f.options);
    assert.equal(f.taps(), 1);
  }
  for (const nodes of [
    [node('hidden-settings-host', full, { visible: false, children: [settings[0]] }), ...settings],
    [{ ...settings[0], bounds: { ...full, y: 3000 } }, login, tab],
    [node('hidden-hall-host', full, { visible: false, children: [hall[0]] }), ...hall],
  ]) {
    const f = fixture([nodes]);
    await assert.rejects(selectGuestSettingsTab(f.device, f.options), /未显示可操作/);
    assert.equal(f.taps(), 1);
  }
});
test('驱动查询或真实点击错误原样传播，不触发额外点击', async () => {
  for (const operation of ['nodes', 'tap']) {
    const f = fixture([hall]);
    const failure = new Error('WDA disconnected');
    if (operation === 'nodes') f.device.nodes = async () => { throw failure; };
    else f.options.tapTab = async () => { throw failure; };
    await assert.rejects(selectGuestSettingsTab(f.device, f.options), error => error === failure);
    assert.ok(f.taps() <= 1);
  }
});
