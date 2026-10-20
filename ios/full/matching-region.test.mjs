import test from 'node:test';
import assert from 'node:assert/strict';
import { animationRegion, matchingModalBounds, matchingSpinnerRegion } from './animation-region.ts';

const screenSize = { width: 1178, height: 2556 };
const node = (res, bounds, clazz = 'XCUIElementTypeOther') => ({ res, bounds, clazz, children: [], visible: true });
// Native failure tree from run 39467862220: the overlay extends 3 px below the screenshot.
const overlay = node('game-matching-loading-view', { x: 0, y: 0, width: 1178, height: 2559 });
const panel = node(undefined, { x: 257, y: 888, width: 664, height: 783 });
const controls = [
  node('game-matching-message', { x: 287, y: 948, width: 604, height: 60 }, 'XCUIElementTypeStaticText'),
  node('game-matching-countdown-text', { x: 560, y: 1053, width: 61, height: 72 }, 'XCUIElementTypeStaticText'),
  node('quick-start-room-cancel', { x: 500, y: 1518, width: 181, height: 78 }, 'XCUIElementTypeStaticText'),
];

test('匹配弹窗取完整原生内容边界，不能把超出截图的全屏遮罩当成内容', () => {
  const nodes = [node(undefined, { x: 0, y: 0, ...screenSize }), overlay, panel, ...controls];
  const expected = { x: 253, y: 884, width: 672, height: 791 };
  assert.deepEqual(matchingModalBounds(nodes, screenSize), expected);
  const result = animationRegion('hall-matching-modal-enter', [], nodes, { screenSize }, overlay.bounds);
  assert.deepEqual(result, { bounds: expected, source: 'native-matching-content-container' });
  assert.deepEqual(animationRegion('hall-matching-modal-exit', nodes, [], { screenSize }, overlay.bounds), result);
});

test('缺失语义控件或实际内容容器时失败，不能静默退回全屏', () => {
  assert.throws(() => matchingModalBounds([overlay, ...controls], screenSize), /真实原生弹窗/);
  assert.throws(() => matchingModalBounds([overlay, panel, ...controls.slice(1)], screenSize), /缺少标题/);
});

test('完整旋转范围由原生弹窗和上下控件确定，不随图标旋转外接矩形变化或裁掉边缘', () => {
  const image = bounds => node('assets/src/laiwan_resource/hall/image/icon_home_load@3x.png', bounds, 'XCUIElementTypeImage');
  const expected = { x: 253, y: 1126, width: 672, height: 391 };
  for (const bounds of [{ x: 473, y: 1254, width: 235, height: 228 },
    { x: 470, y: 1248, width: 240, height: 240 }]) {
    assert.deepEqual(matchingSpinnerRegion([overlay, panel, ...controls, image(bounds)], screenSize), expected);
  }
  assert.throws(() => matchingSpinnerRegion([overlay, panel, ...controls], screenSize), /完整位于/);
  assert.throws(() => matchingSpinnerRegion([overlay, panel, ...controls,
    image({ x: 470, y: 1500, width: 240, height: 240 })], screenSize), /完整位于/);
});
