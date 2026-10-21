import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBuyInPanelBounds } from './animation-region.ts';
const screen = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const controls = [node('buy-in-title', { x: 455, y: 939, width: 271, height: 63 }),
  node('buy-in-close-button', { x: 926, y: 813, width: 130, height: 126 }),
  node('buy-in-confirm-button', { x: 392, y: 1611, width: 394, height: 102 })];
const panel = node(undefined, { x: 122, y: 813, width: 934, height: 930 });
test('买入弹窗包含完整背景和右上角关闭按钮，不依赖透明辅助文字', () => {
  assert.deepEqual(nativeBuyInPanelBounds([panel, ...controls], screen), { x: 118, y: 809, width: 942, height: 938 });
  assert.throws(() => nativeBuyInPanelBounds([node(undefined, { x: 0, y: 0, ...screen }), ...controls], screen), /完整原生/);
  assert.throws(() => nativeBuyInPanelBounds([panel, ...controls.slice(1)], screen), /可见标题/);
});
