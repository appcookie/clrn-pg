import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCountryPicker } from './country-picker.ts';
import { navigateScenario } from './navigation.ts';
import { screenshotMasks } from './screenshot.ts';

const marker = { res: 'country-code-list', clazz: 'XCUIElementTypeOther', enabled: true, visible: true, children: [],
  bounds: { x: 0, y: 300, width: 1178, height: 20_000 } };
const row = { res: 'country-code-list-item-852', clazz: 'XCUIElementTypeOther', enabled: true, visible: true, children: [],
  bounds: { x: 0, y: 500, width: 1178, height: 100 } };
const back = { res: 'back-button', clazz: 'XCUIElementTypeOther', enabled: true, visible: true, children: [],
  bounds: { x: 0, y: 270, width: 159, height: 42 } };
function deviceWith(nodes) {
  const list = nodes.find(node => node.res === 'country-code-list');
  if (list) list.children = nodes.filter(node => node !== list && node !== back);
  nodes = [...nodes, back];
  const calls = { snapshots: 0 };
  return { calls, screenSize: { width: 1178, height: 2556 }, nodes: async () => { calls.snapshots++; return nodes; },
    wait: async () => { throw new Error("不得为同一页面重复读取独立 wait 快照"); } };
}

test('国家列表容器超过屏幕时，真实可操作的区号行足以确认页面，无需滚动整页容器', async () => {
  const device = deviceWith([marker, row]);
  await waitForCountryPicker(device);
  assert.equal(device.calls.snapshots, 1);
});

test('背景手机号选择器、隐藏/离屏/禁用列表不能被当作国家列表已就绪', async () => {
  for (const nodes of [[row], [marker], [marker, { ...row, res: 'country-code-selector' }],
    [marker, { ...row, enabled: false }], [marker, { ...row, bounds: { ...row.bounds, y: 3000 } }],
    [marker, { ...row, visible: false }],
    [marker, { ...row, bounds: { ...row.bounds, width: 0 } }]]) {
    await assert.rejects(waitForCountryPicker(deviceWith(nodes), { timeout: 0 }), /未显示|没有可见/);
  }
});

test('区号行虽在屏幕内，仍拒绝被真实列表祖先裁切或隐藏的行', async () => {
  const scroll = { res: 'country-list', clazz: 'XCUIElementTypeScrollView', visible: true, enabled: true,
    bounds: { x: 0, y: 300, width: 1178, height: 200 }, children: [row] };
  await assert.rejects(waitForCountryPicker(deviceWith([marker, scroll, row])), /没有可见/);
  const hidden = { ...scroll, visible: false, bounds: { x: 0, y: 300, width: 1178, height: 1000 } };
  await assert.rejects(waitForCountryPicker(deviceWith([marker, hidden, row])), /没有可见/);
  await waitForCountryPicker(deviceWith([marker, { ...hidden, visible: true }, row]));
});

test('即使背景列表可见，也不能把系统错误弹窗当作国家选择页', async () => {
  await assert.rejects(waitForCountryPicker(deviceWith([marker, row, { clazz: 'XCUIElementTypeAlert' }])), /错误弹窗遮挡/);
});

test('同一快照还必须排除加载、键盘和应用错误，不能省略导航尾部检查', async () => {
  for (const [extra, message] of [
    [{ clazz: 'XCUIElementTypeActivityIndicator' }, /仍在加载/],
    [{ clazz: 'XCUIElementTypeKeyboard' }, /键盘遮挡/],
    [{ res: 'alert-message-text' }, /应用错误提示/],
  ]) await assert.rejects(waitForCountryPicker(deviceWith([marker, row, extra]), { timeout: 0 }), message);
});

test('树读取的驱动错误原样传播，不转成页面就绪或反复重试', async () => {
  const device = deviceWith([marker, row]);
  const failure = new Error('WebDriver session unavailable');
  let calls = 0;
  device.nodes = async () => { calls++; throw failure; };
  await assert.rejects(waitForCountryPicker(device), error => error === failure);
  assert.equal(calls, 1);
});

test('sheet出现前只轮询缺少的真实控件，所有最终几何断言复用同一快照', async () => {
  const device = deviceWith([marker, row]);
  const readyNodes = device.nodes;
  let calls = 0;
  device.nodes = async () => ++calls === 1 ? [] : readyNodes();
  await waitForCountryPicker(device);
  assert.equal(calls, 2);
  assert.equal(device.calls.snapshots, 1);
});

test('静态country从导航就绪到截图遮罩只读一次AX，传递原始叶子引用，无隐式缓存', async () => {
  const country = deviceWith([marker, row]);
  const readyNodes = await country.nodes();
  const tab = { ...back, res: 'settings-tab', bounds: { x: 0, y: 100, width: 100, height: 50 } };
  const entry = { ...tab, res: 'country-code-selector', bounds: { ...tab.bounds, x: 200 } };
  let opened = false;
  let countryReads = 0;
  const device = {
    screenSize: country.screenSize,
    nodes: async () => { if (opened) { countryReads++; return readyNodes; } return [tab, entry]; },
    wait: async ({ res }) => assert.ok([tab.res, entry.res].includes(res)),
    info: async ({ res }) => { assert.ok([tab.res, entry.res].includes(res)); return res === tab.res ? tab : entry; },
    input: { tap: async ({ x }) => { if (x > 200) opened = true; } },
  };
  const scenario = { pageLabel: 'login_pick_country_code', tabTestId: 'settings-tab',
    visualReadySelector: '[data-testid="pick-country-code-container"]',
    navClickTestIds: ['country-code-selector'], fixedTexts: [], waitForLoading: true, signIn: false };
  const result = await navigateScenario(device, scenario);
  assert.equal(result.readySnapshot, readyNodes);
  assert.equal(result.readySnapshot.find(node => node.res === row.res), row);
  assert.deepEqual(await screenshotMasks(device, scenario, result.backgroundBanner, result.readySnapshot), []);
  assert.equal(countryReads, 1);
  opened = false;
  await assert.rejects(navigateScenario(device, { ...scenario, readyText: 'new constraint' }), /尚未覆盖新增场景约束/);
});

test('3dc真实国家选择sheet只暴露list/back及其列表行，不再等待隐藏Web容器', async () => {
  const actualRow = { ...row, res: 'country-code-list-item-86', bounds: { x: 0, y: 450, width: 1178, height: 120 } };
  const scroll = { ...marker, res: undefined, clazz: 'XCUIElementTypeScrollView',
    bounds: { x: 0, y: 375, width: 1178, height: 2181 }, children: [actualRow] };
  const list = { ...marker, bounds: { ...scroll.bounds }, children: [scroll] };
  const nodes = [back, list, scroll, actualRow];
  const device = { screenSize: { width: 1178, height: 2556 }, nodes: async () => nodes,
    wait: async ({ res, enabled }) => assert.ok(nodes.some(node => (typeof res === 'string' ? node.res === res : res.test(node.res || ''))
      && (enabled === undefined || node.enabled === enabled))) };
  await waitForCountryPicker(device);
  list.children = [];
  await assert.rejects(waitForCountryPicker(device), /没有可见且启用/);
  list.children = [scroll];
  nodes[0] = { ...back, enabled: false };
  await assert.rejects(waitForCountryPicker(device, { timeout: 0 }));
});
