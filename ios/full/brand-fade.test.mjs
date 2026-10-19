import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { brandFadeEvidence } from './brand-fade.ts';

const region = { x: 25, y: 20, width: 50, height: 20 };
const reference = new PNG({ width: 100, height: 160 });
for (let y = 0; y < 160; y++) {
  for (let x = 0; x < 100; x++) {
    const cloud = Math.sin(x / 8) * Math.cos(y / 19) * 22;
    const forest = x < y % 65 ? 18 : 0;
    reference.data.set([
      55 + x / 3 + cloud - forest,
      95 + y / 4 + cloud,
      165 + cloud - forest,
      255,
    ], (y * 100 + x) * 4);
  }
}

function frame(alpha, gain = 1, offset = 0, system = false) {
  const picture = new PNG({ width: 100, height: 160 });
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 100; x++) {
      const pixelOffset = (y * 100 + x) * 4;
      const ink = x >= 25 && x < 75 && y >= 20 && y < 40 && ((x - 25) % 8 < 3 || y < 24);
      for (let channel = 0; channel < 3; channel++) {
        const base = reference.data[pixelOffset + channel];
        const content = base + (ink ? (230 - base) * alpha : 0);
        picture.data[pixelOffset + channel] = system
          ? 255 * (1 - gain) + content * gain
          : content * gain + offset;
      }
      picture.data[pixelOffset + 3] = 255;
    }
  }
  return PNG.sync.write(picture);
}

test('原生品牌自身淡入可在同时变化的Staging暗层中识别', () => {
  const frames = [0, 0.25, 0.55, 0.8, 1].map((alpha, index) => frame(alpha, 0.9 - index * 0.075, 7));
  const evidence = brandFadeEvidence(frames, frame(1, 0.6, 7), reference, region, []);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.start, 0);
  assert.equal(evidence.end, 4);
  assert.ok(evidence.samples[1].alpha > 0.2 && evidence.samples[1].alpha < 0.3);
});

test('只有遮罩解除或系统整页渐变时，完整品牌不能冒充淡入', () => {
  for (const system of [false, true]) {
    const frames = [0.35, 0.5, 0.7, 0.9, 1].map(gain => frame(1, gain, 0, system));
    assert.equal(brandFadeEvidence(frames, frame(1), reference, region, []).complete, false);
  }
});

test('缺透明起点、中途两相位或真实终点都明确不完整', () => {
  for (const phases of [[1, 1, 1, 1], [0, 0, 1, 1], [0, 0.25, 0.55, 0.8]]) {
    const frames = phases.map(alpha => frame(alpha));
    assert.equal(brandFadeEvidence(frames, frame(1), reference, region, []).complete, false);
  }
});

test('系统纯色屏不能成为匹配发布包背景的品牌证据', () => {
  const blank = new PNG({ width: 100, height: 160 });
  blank.data.fill(255);
  const bytes = PNG.sync.write(blank);
  assert.throws(() => brandFadeEvidence([bytes], bytes, reference, region, []), /真实发布包启动背景/);
});

test('品牌区域拒绝越界、非整数、空范围和非有限坐标', () => {
  const bytes = frame(1);
  const invalidRegions = [
    { ...region, x: -1 },
    { ...region, x: 60 },
    { ...region, y: 150 },
    { ...region, x: 0.5 },
    { ...region, height: 1.5 },
    { ...region, width: 0 },
    { ...region, height: -1 },
    { ...region, y: NaN },
    { ...region, width: Infinity },
  ];
  for (const invalid of invalidRegions) {
    assert.throws(() => brandFadeEvidence([bytes], bytes, reference, invalid, []), /非空整数像素矩形/);
  }
});
