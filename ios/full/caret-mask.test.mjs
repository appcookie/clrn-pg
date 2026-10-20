import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { caretMask, translateCaret } = require('./caret-mask.ts');

test('键盘收起只平移检测到的细光标，不把输入框或文字一起遮住', () => {
  const mask = { x: 369, y: 684, width: 4, height: 38, reason: '真实光标' };
  assert.deepEqual(translateCaret({ mask, input: { bounds: { x: 69, y: 643, width: 582, height: 80 } } },
    { x: 69, y: 915, width: 582, height: 80 }), { ...mask, y: 956 });
});

test('光标识别仅覆盖聚焦框内的窄竖线，保留外部变化并拒绝文字块变化', () => {
  const before = new PNG({ width: 100, height: 100 });
  before.data.fill(255);
  const after = PNG.sync.read(PNG.sync.write(before));
  for (let y = 20; y < 50; y++) for (let x = 40; x < 43; x++) after.data[(y * 100 + x) * 4] = 0;
  after.data[0] = 0;
  const bounds = { x: 10, y: 10, width: 80, height: 60 };
  const mask = caretMask(PNG.sync.write(before), PNG.sync.write(after), bounds);
  assert.deepEqual({ ...mask, reason: undefined }, { x: 40, y: 20, width: 3, height: 30, reason: undefined });
  after.data[(20 * 100 + 55) * 4] = 0;
  assert.equal(caretMask(PNG.sync.write(before), PNG.sync.write(after), bounds), undefined);
  assert.equal(caretMask(PNG.sync.write(before), PNG.sync.write(before), bounds), undefined);
});
