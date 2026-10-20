import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launchBrandPixelBounds, reviewedBrandFrameMatches } from './web-animation-parity.ts';

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

test('品牌起止相位允许统一色调变化，但拒绝翻转或缺失品牌文字', () => {
  const base = 'ios/snapshots/v1/launch/launch/launch-branding/ios/iphone16-ios18.5/en/animation/';
  const start = readFileSync(`${base}start.png`), end = readFileSync(`${base}end.png`);
  for (const original of [start, end]) {
    const tinted = PNG.sync.read(original);
    for (let i = 0; i < tinted.data.length; i += 4) for (let c = 0; c < 3; c++) {
      tinted.data[i + c] = Math.min(255, Math.max(0, Math.round(tinted.data[i + c] * 1.04 - 3)));
    }
    assert.equal(reviewedBrandFrameMatches(PNG.sync.write(tinted), original), true);
    const flipped = new PNG({ width: tinted.width, height: tinted.height });
    for (let y = 0; y < tinted.height; y++) for (let x = 0; x < tinted.width; x++) {
      const from = (y * tinted.width + x) * 4;
      const to = (y * tinted.width + tinted.width - x - 1) * 4;
      tinted.data.copy(flipped.data, to, from, from + 4);
    }
    assert.equal(reviewedBrandFrameMatches(PNG.sync.write(flipped), original), false);
  }
  assert.equal(reviewedBrandFrameMatches(start, end), false);
});
