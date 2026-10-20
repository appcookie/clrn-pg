import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { frameColorDistance } from './animation-transition';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice, NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { motionParts } from './motion-regions';
import { assertVisual } from './device';
import { brandFadeEvidence } from './brand-fade';
import { baselinePath } from './baseline-path.mjs';

/** Modal-hidden native descendants retain layout, not visibility or clickability. */
export function launchBrandPixelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const seen = new Set<NativeNode>();
  const candidates = new Map<string, ScreenshotBounds>();
  function visit(node: NativeNode) {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.res === 'launch-brand-name') {
      const { x, y, width, height } = node.bounds;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > screen.width || y + height > screen.height) throw new Error('原生品牌文字边界必须完整位于截图内。');
      const bounds = { x, y, width, height };
      candidates.set(JSON.stringify(bounds), bounds);
    }
    node.children.forEach(visit);
  }
  nodes.forEach(visit);
  if (candidates.size !== 1) throw new Error('必须从当前原生布局取得唯一的品牌文字像素边界。');
  return [...candidates.values()][0];
}

/** 用原始首尾像素拟合固定位置淡入；移动、闪屏或只有终态不能冒充透明度变化。 */
export function fadeSamples(frames: Buffer[]) {
  if (frames.length < 3) throw new Error('淡入需要连续原始帧');
  const images = frames.map(bytes => PNG.sync.read(bytes));
  const first = images[0], last = images.at(-1)!;
  if (images.some(image => image.width !== first.width || image.height !== first.height)) throw new Error('淡入区域尺寸变化');
  const channels: number[] = [];
  for (let i = 0; i < first.data.length; i++) if (i % 4 !== 3 && Math.abs(last.data[i] - first.data[i]) > 24) channels.push(i);
  if (channels.length < first.width * first.height * .03) throw new Error('品牌区域缺少足够真实变化');
  const denominator = channels.reduce((sum, i) => sum + (last.data[i] - first.data[i]) ** 2, 0);
  return images.map(image => {
    const alpha = channels.reduce((sum, i) => sum + (image.data[i] - first.data[i]) * (last.data[i] - first.data[i]), 0) / denominator;
    let squared = 0;
    for (let i = 0; i < first.data.length; i++) if (i % 4 !== 3) squared += (image.data[i] - first.data[i] - alpha * (last.data[i] - first.data[i])) ** 2;
    const residual = Math.sqrt(squared / (first.width * first.height * 3));
    return { alpha, residual };
  });
}
export function requireFade(frames: Buffer[]) {
  const samples = fadeSamples(frames);
  const middle = samples.map((sample, index) => ({ ...sample, index }))
    .filter(sample => sample.alpha > .1 && sample.alpha < .9 && sample.residual < 12);
  const pair = middle.find(a => middle.some(b => b.index > a.index && b.alpha > a.alpha + .15));
  if (!pair) throw new Error('未采到固定品牌像素从半透明逐步变清晰的两个相位');
  return { samples, middle: pair.index };
}
export async function assertBrandFade(frames: Buffer[], finalFrame: Buffer, reference: PNG,
  region: ScreenshotBounds, exclusions: ScreenshotBounds[], info: TestInfo,
  evidence?: ReturnType<typeof brandFadeEvidence>) {
  const cropped = frames.map(frame => motionParts(frame, [region]).regions[0]);
  const result = evidence ?? brandFadeEvidence(frames, finalFrame, reference, region, exclusions);
  await info.attach('launch-branding-fade-opacity-fit', { body: JSON.stringify(result.samples), contentType: 'application/json' });
  expect(result.complete, '必须在发布包背景已出现后采到品牌自身从透明、两个半透明相位到不透明；不能用系统转场或遮罩消退代替').toBe(true);
  for (const [phase, index] of [['start', result.start!], ['middle', result.middle!], ['end', result.end!]] as const) {
    const name = `launch-branding-fade-${phase}.png`;
    if (phase !== 'middle' || process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(cropped[index], name, info);
    else {
      const reviewed = readFileSync(baselinePath(name));
      const candidates = result.samples.flatMap((sample, i) => sample.alpha !== null && sample.residual !== null
        && sample.alpha > .1 && sample.alpha < .9 && sample.residual < 12 ? [cropped[i]] : []);
      expect(Math.min(...candidates.map(frame => frameColorDistance(frame, reviewed))), '品牌真实半透明相位须匹配已审查基准').toBeLessThanOrEqual(12);
      await info.attach(name, { body: cropped[index], contentType: 'image/png' });
    }
  }
}
export async function clickNode(device: NativeDevice, selector: { res?: string | RegExp; text?: string | RegExp; clazz?: string | RegExp }) {
  const node = await device.info(selector);
  expect(node.enabled).toBe(true);
  await device.input.tap({ x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 });
}
