// 真实翻牌端点只相差两个超容差像素；缺牌、错位和牌面变色必须继续失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { compareAnimationEndpoint } from './animation-endpoint.ts';
import { samePixels } from './motion-regions.ts';

const baseline = readFileSync('ios/snapshots/v1/texas-holdem/table/texas-flop/ios/iphone16-ios18.5/en/animation/end.png');
const actual = readFileSync(new URL('./fixtures/animation-endpoint/flop-render-variation.png', import.meta.url));
const references = [{ name: 'reviewed-flop-end', bytes: baseline }];

test('独立终点使用静态截图的现有容差，运动相位仍逐像素严格比较', () => {
  const result = compareAnimationEndpoint(actual, references);
  assert.equal(result.matches, true);
  assert.equal(result.comparisons[0].changedRatio, 2 / 81000);
  assert.equal(samePixels(actual, baseline), false);
});

test('翻牌终点仍拒绝缺牌、整像素错位、字形损坏和明显变色', () => {
  for (const kind of ['missing', 'translated', 'glyph', 'color']) {
    const picture = PNG.sync.read(baseline);
    const source = Buffer.from(picture.data);
    for (let y = 8; y < 185; y++) for (let x = 277; x < 398; x++) {
      const offset = (y * picture.width + x) * 4;
      if (kind === 'missing') picture.data.set([45, 140, 118, 255], offset);
      if (kind === 'translated') source.copy(picture.data, offset, offset - 4, offset);
      if (kind === 'glyph' && x >= 297 && x < 320 && y >= 26 && y < 38)
        picture.data.set([235, 235, 235, 255], offset);
      if (kind === 'color') picture.data[offset] = 160;
    }
    const result = compareAnimationEndpoint(PNG.sync.write(picture), references);
    assert.equal(result.matches, false, kind);
    assert.ok(result.diff, kind);
  }
});

test('终点不能缺失基准或改变尺寸，额外已审查相位按同一规则比较', () => {
  assert.throws(() => compareAnimationEndpoint(actual, []), /已审查基准/);
  const wrongSize = PNG.sync.write(new PNG({ width: 404, height: 200 }));
  assert.equal(compareAnimationEndpoint(wrongSize, references).matches, false);
  const result = compareAnimationEndpoint(actual, [{ name: 'wrong-size', bytes: wrongSize }, ...references]);
  assert.equal(result.matches, true);
  assert.deepEqual(result.comparisons.map(item => item.matches), [false, true]);
});
