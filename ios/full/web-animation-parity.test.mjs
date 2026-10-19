import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrandPixelBounds } from './web-animation-parity.ts';

const screen = { width: 1178, height: 2556 };
// Fifth English CI: notice still open and notice dismissed both report exactly
// these native bounds. The former appears only in nested, modal-hidden children.
const bounds = { x: 68, y: 345, width: 1042, height: 186 };
function brand(visible = false, layout = bounds) {
  return { res: 'launch-brand-name', clazz: 'XCUIElementTypeStaticText', text: 'GoPlay360',
    bounds: { ...layout }, children: [], visible };
}
function parent(children) {
  return { res: 'launch-wrapper', clazz: 'XCUIElementTypeOther', bounds: { x: 68, y: 345, width: 1042, height: 312 },
    children, visible: false };
}

test('提示框仍显示时，从隐藏原生子树读取与关闭提示后相同的真实品牌边界', () => {
  const hidden = brand();
  const measured = launchBrandPixelBounds([parent([hidden])], screen);
  assert.deepEqual(measured, bounds);
  assert.deepEqual(measured, launchBrandPixelBounds([brand(true)], screen));
  assert.equal(hidden.visible, false, '读取像素区域不能把后台节点变为可见或可点');
  assert.notEqual(measured, hidden.bounds, '返回独立几何，避免调用者修改原生布局');
});

test('平铺列表与children重复出现同一个品牌，只接受一致的几何', () => {
  const target = brand();
  assert.deepEqual(launchBrandPixelBounds([parent([target]), target, structuredClone(target)], screen), bounds);
  assert.throws(() => launchBrandPixelBounds([target, brand(true, { ...bounds, y: 346 })], screen), /唯一/);
});

test('缺少品牌、边界为空、非有限数或超出当前截图均失败', () => {
  assert.throws(() => launchBrandPixelBounds([parent([])], screen), /唯一/);
  for (const invalid of [{ ...bounds, width: 0 }, { ...bounds, x: -1 }, { ...bounds, y: NaN },
    { ...bounds, x: 1000 }, { ...bounds, y: 2500 }]) {
    assert.throws(() => launchBrandPixelBounds([brand(false, invalid)], screen), /完整位于截图内/);
  }
});
