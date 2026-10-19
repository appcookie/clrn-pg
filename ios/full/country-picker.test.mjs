import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCountryPicker } from './country-picker.ts';

const marker = { res: 'pick-country-code-container', clazz: 'XCUIElementTypeOther', enabled: true, visible: true, children: [],
  bounds: { x: 0, y: 300, width: 1178, height: 20_000 } };
const row = { res: 'country-code-list-item-852', clazz: 'XCUIElementTypeOther', enabled: true, visible: true, children: [],
  bounds: { x: 0, y: 500, width: 1178, height: 100 } };
function deviceWith(nodes) {
  const waits = [];
  return { waits, screenSize: { width: 1178, height: 2556 }, nodes: async () => nodes,
    wait: async (selector, options) => { waits.push({ selector, options }); } };
}

test('国家列表容器超过屏幕时，真实可操作的区号行足以确认页面，无需滚动整页容器', async () => {
  const device = deviceWith([marker, row]);
  await waitForCountryPicker(device);
  assert.equal(device.waits.length, 2);
  assert.equal(device.waits[0].selector.res, 'pick-country-code-container');
  assert.equal(device.waits[1].selector.res.test('country-code-list-item-852'), true);
  assert.equal(device.waits[1].selector.enabled, true);
  assert.equal(device.waits.every(({ options }) => options.timeout === 10_000), true);
});

test('背景手机号选择器、隐藏/离屏/禁用列表不能被当作国家列表已就绪', async () => {
  for (const nodes of [[row], [marker], [marker, { ...row, res: 'country-code-selector' }],
    [marker, { ...row, enabled: false }], [marker, { ...row, bounds: { ...row.bounds, y: 3000 } }],
    [marker, { ...row, visible: false }],
    [marker, { ...row, bounds: { ...row.bounds, width: 0 } }]]) {
    await assert.rejects(waitForCountryPicker(deviceWith(nodes)), /未显示|没有可见/);
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

test('就绪查询和树读取的驱动错误原样传播，不转成页面就绪', async () => {
  for (const method of ['wait', 'nodes']) {
    const device = deviceWith([marker, row]);
    const failure = new Error('WebDriver session unavailable');
    device[method] = async () => { throw failure; };
    await assert.rejects(waitForCountryPicker(device), error => error === failure);
  }
});
