import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAlertPanelBounds, animationRegion } from './animation-region.ts';
import { alertEndpointClockMasks } from './alert-endpoint-masks.ts';
const screenSize = { width: 1178, height: 2556 };
const node = (res, bounds, text) => ({ res, bounds, text, visible: true, clazz: 'XCUIElementTypeOther' });
// Run 39516683786. The old Android crop included 170 px of unrelated table;
// its old clock mask also erased the popup's bottom 20 px.
const panel = node(undefined, { x: 152, y: 1098, width: 874, height: 360 });
const controls = [
  node('common-alert-message', { x: 434, y: 1161, width: 313, height: 57 }, 'Please retry-call'),
  node('common-alert-button-undefined', { x: 236, y: 1281, width: 304, height: 93 }, 'Cancel'),
  node('common-alert-button-undefined', { x: 641, y: 1281, width: 304, height: 93 }, 'Retry'),
];
const root = node('common-alert-container', { x: 0, y: 0, ...screenSize });
test('错误弹窗裁图包含完整背景边缘、消息和所有按钮，不使用全屏触摸层', () => {
  const nodes = [root, panel, ...controls], bounds = { x: 148, y: 1094, width: 882, height: 368 };
  assert.deepEqual(nativeAlertPanelBounds(nodes, screenSize), bounds);
  assert.deepEqual(animationRegion('texas-alert-retry-exit', nodes, [], { screenSize }, {}).bounds, bounds);
  assert.deepEqual(animationRegion('texas-alert-auth-enter', [], nodes, { screenSize }, {}).bounds, bounds);
  assert.throws(() => nativeAlertPanelBounds([root, ...controls], screenSize), /完整原生/);
  assert.throws(() => nativeAlertPanelBounds([panel, controls[0]], screenSize), /消息和按钮/);
});
test('牌局时钟只在没有错误弹窗的端点排除，不能擦掉弹窗底边', () => {
  const clock = node('countdown-text', { x: 584, y: 1434, width: 184, height: 45 }, '00:54:28');
  assert.equal(alertEndpointClockMasks([clock]).length, 1);
  assert.deepEqual(alertEndpointClockMasks([clock, ...controls]), []);
  assert.deepEqual(alertEndpointClockMasks([{ ...clock, res: 'common-alert-message' }]), []);
  assert.deepEqual(alertEndpointClockMasks([{ ...clock, text: 'Waiting to start' }]), []);
});
